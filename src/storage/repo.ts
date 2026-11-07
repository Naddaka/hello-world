import type { ZElement } from '../model/types';

/** Persistent storage of elements. */
export interface Repo {
  loadAll(): Promise<ZElement[]>;
  /** Writes changed elements and removes deleted ones in one batch. */
  save(changed: ZElement[], removedIds: string[]): Promise<void>;
}

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function openRepo(): Promise<Repo> {
  if (isTauri()) {
    const { SqliteRepo } = await import('./sqliteRepo');
    return SqliteRepo.open();
  }
  const { IdbRepo } = await import('./idbRepo');
  return IdbRepo.open();
}
