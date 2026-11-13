import { clearHistory, commit, flushPersist, useStore } from '../model/store';
import { HOME_ID, type ZElement } from '../model/types';
import { otherImportRoots, planReplacement } from './replace';
import { media } from '../storage/media';
import { dataUrlToBlob } from '../storage/dataUrl';
import { inTrash, planIconRefresh, type IconRefreshPlan, type ImportedBoard } from './milanoteIcons';
import { updateOp } from '../model/ops';
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

/** The previous import of the same account (it would be replaced), and imports of other accounts (they stay). */
export function existingImports(data: MilanoteExport): { same: ZElement | undefined; others: ZElement[] } {
  const elements = useStore.getState().elements;
  const rootId = `${MN_PREFIX}${data.roots?.home ?? 'home'}`;
  return { same: elements[rootId], others: otherImportRoots(elements, rootId) };
}

/**
 * Brings a Milanote export into Zadum: converts it, downloads every file into
 * the media library, then adds everything in one go as a "Milanote" board on
 * the home board. A previous import of the same account is replaced.
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
  // A previous import left in the trash is replaced too, but the new one goes on the home board, not into the trash.
  if (previous && !inTrash(state as unknown as Record<string, Record<string, unknown>>, plan.rootId)) {
    Object.assign(root, { parentId: previous.parentId, section: previous.section, x: previous.x, y: previous.y, z: previous.z });
  } else {
    const home = Object.values(state).filter((e) => e.parentId === HOME_ID && e.section === 'CANVAS' && e.type !== 'LINE');
    const right = home.length ? Math.max(...home.map((e) => e.x + e.width)) : 0;
    const top = home.length ? Math.min(...home.map((e) => e.y)) : 0;
    Object.assign(root, { parentId: HOME_ID, section: 'CANVAS', x: right + 4, y: top, z: Math.max(0, ...home.map((e) => e.z)) + 1 });
  }

  const { ops, removed, orphans } = planReplacement(state, elements, plan.rootId);
  // Not an undo step: the import is too large to undo by accident.
  commit(ops, false);
  if (removed.size) {
    // Earlier undo steps may refer to the replaced elements; they cannot come back.
    clearHistory();
    await flushPersist();
    await (await media()).remove(orphans).catch((error) => console.warn('Milanote import: could not remove old files', error));
  }
  return { report: plan.report, rootId: plan.rootId };
}


/**
 * Puts the board icons of a saved export on boards imported earlier, without
 * importing again: only the icon field changes, as one undo step. Pictures are
 * downloaded first; one that fails leaves its board as it was.
 */
export async function refreshMilanoteIcons(
  data: MilanoteExport,
  replace: boolean,
  onProgress: (p: ImportProgress) => void = () => {},
): Promise<IconRefreshPlan & { updated: number }> {
  // Where each board sits after an import (titles and places find copies made by hand).
  const converted = convertMilanote(data).elements;
  const imported: ImportedBoard[] = converted.flatMap((e) =>
    e.type === 'BOARD' || e.type === 'COLUMN'
      ? [{ id: e.id, type: e.type, parentId: e.parentId, title: e.title, x: e.x, y: e.y, z: e.z, content: data.elements[e.id.slice(MN_PREFIX.length)]?.content }]
      : [],
  );
  const plan = planIconRefresh(useStore.getState().elements as unknown as Record<string, Record<string, unknown>>, imported, replace);
  const pictures = plan.changes.filter((c) => c.imageUrl);
  // One download per picture, shared by all copies of a board.
  const urls = [...new Set(pictures.map((c) => c.imageUrl!))];
  const stored = new Map<string, StoredMedia | null>();
  let done = 0;
  onProgress({ phase: 'media', done, total: urls.length });
  const queue = [...urls];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let url = queue.shift(); url; url = queue.shift()) {
        stored.set(url, await storeJob({ key: url, url, name: 'иконка.png', role: 'board-icon', elementId: '' }));
        done++;
        onProgress({ phase: 'media', done, total: urls.length });
      }
    }),
  );
  for (const change of pictures) {
    const got = stored.get(change.imageUrl!);
    if (got) change.icon = `media:${got.id}.${got.ext}`;
    else {
      plan.exact--;
      plan.missing++;
      if (!plan.shapes.includes('image: не скачалась')) plan.shapes.push('image: не скачалась');
    }
  }
  onProgress({ phase: 'saving', done, total: urls.length });
  const elements = useStore.getState().elements;
  const ops = plan.changes.filter((c) => c.icon && elements[c.id]).map((c) => updateOp(elements[c.id], { icon: c.icon }));
  // Icons are not edits: boards keep their "changed" time (recent lists stay in order).
  commit(ops, true, false);
  return { ...plan, updated: ops.length };
}
