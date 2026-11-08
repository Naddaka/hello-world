import { commit, useStore } from '../model/store';
import type { Op } from '../model/ops';
import { HOME_ID, type ZElement } from '../model/types';
import { media } from '../storage/media';
import { dataUrlToBlob } from '../storage/dataUrl';
import { convertMilanote, finalizeImport, MN_PREFIX, type ImportReport, type MediaJob, type MilanoteExport, type StoredMedia } from './milanote';

export interface ImportProgress {
  phase: 'media' | 'saving';
  done: number;
  total: number;
  /** Name of the file being downloaded. */
  current?: string;
}

const CONCURRENCY = 4;

async function storeJob(job: MediaJob): Promise<StoredMedia | null> {
  const lib = await media();
  try {
    if (job.svg) return await lib.importFile(new File([job.svg], job.name, { type: 'image/svg+xml' }));
    if (!job.url) return null;
    if (job.url.startsWith('data:')) {
      const blob = dataUrlToBlob(job.url);
      return await lib.importFile(new File([blob], job.name, { type: blob.type }));
    }
    return await lib.download(job.url, job.name);
  } catch (error) {
    console.warn('Milanote import: could not store', job.url ?? job.name, error);
    return null;
  }
}

/** Whether a previous Milanote import exists (it would be replaced). */
export function previousImport(data: MilanoteExport): ZElement | undefined {
  return useStore.getState().elements[`${MN_PREFIX}${data.roots?.home ?? 'home'}`];
}

/**
 * Brings a Milanote export into Zadum: converts it, downloads every file into
 * the media library, then adds everything in one go as a "Milanote" board on
 * the home board. A previous import is replaced.
 */
export async function importMilanote(
  data: MilanoteExport,
  onProgress: (p: ImportProgress) => void = () => {},
): Promise<{ report: ImportReport; rootId: string }> {
  const plan = convertMilanote(data);
  const results = new Map<string, StoredMedia | null>();
  let done = 0;
  const total = plan.media.length;
  onProgress({ phase: 'media', done, total });
  const queue = [...plan.media];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        onProgress({ phase: 'media', done, total, current: job.name });
        results.set(job.key, await storeJob(job));
        done++;
        onProgress({ phase: 'media', done, total, current: job.name });
      }
    }),
  );

  onProgress({ phase: 'saving', done: total, total });
  const elements = finalizeImport(plan, results);
  const state = useStore.getState().elements;

  // The Milanote board goes where the previous import was, or to the right of the home content.
  const root = elements.find((e) => e.id === plan.rootId)!;
  const previous = state[plan.rootId];
  if (previous) {
    Object.assign(root, { parentId: previous.parentId, section: previous.section, x: previous.x, y: previous.y, z: previous.z });
  } else {
    const home = Object.values(state).filter((e) => e.parentId === HOME_ID && e.section === 'CANVAS' && e.type !== 'LINE');
    const right = home.length ? Math.max(...home.map((e) => e.x + e.width)) : 0;
    const top = home.length ? Math.min(...home.map((e) => e.y)) : 0;
    Object.assign(root, { parentId: HOME_ID, section: 'CANVAS', x: right + 4, y: top, z: Math.max(0, ...home.map((e) => e.z)) + 1 });
  }

  const ops: Op[] = [];
  for (const e of Object.values(state)) if (e.id.startsWith(MN_PREFIX)) ops.push({ kind: 'delete', element: e });
  for (const e of elements) ops.push({ kind: 'create', element: e });
  // Not an undo step: the import is too large to undo by accident.
  commit(ops, false);
  return { report: plan.report, rootId: plan.rootId };
}

