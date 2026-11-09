import { useStore } from '../model/store';
import { mediaRefsOf } from '../model/types';
import { media } from './media';

/** Files unused for this long are deleted on the next launch. */
const MIN_AGE_SECS = 24 * 3600;

/**
 * Some time after launch, deletes library files no element refers to: pictures
 * of a board icon that was replaced, files of things removed from the trash,
 * leftovers whose undo history ended with the last session. Items in the trash
 * still count as used. Files younger than a day always stay.
 */
export function scheduleMediaCleanup(delayMs = 30_000) {
  window.setTimeout(() => void cleanMedia(), delayMs);
}

export async function cleanMedia(): Promise<number> {
  const { ready, elements } = useStore.getState();
  const all = Object.values(elements);
  if (!ready || all.length === 0) return 0;
  const keep = new Set(all.flatMap((e) => mediaRefsOf(e).map((r) => r.id)));
  // Nothing refers to any file: rather a database problem than a clean library.
  if (keep.size === 0) return 0;
  try {
    const removed = await (await media()).prune([...keep], MIN_AGE_SECS);
    if (removed) console.info(`Media library: removed ${removed} unused file(s)`);
    return removed;
  } catch (error) {
    console.warn('Media library: cleanup skipped', error);
    return 0;
  }
}
