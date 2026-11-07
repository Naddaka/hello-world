import { openDB, type IDBPDatabase } from 'idb';
import type { ZElement } from '../model/types';
import type { Repo } from './repo';

const DB_NAME = 'zadum';
const STORE = 'elements';

/** Browser storage (IndexedDB), used when running outside the desktop shell. */
export class IdbRepo implements Repo {
  private constructor(private readonly db: IDBPDatabase) {}

  static async open(name = DB_NAME): Promise<IdbRepo> {
    const db = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore(STORE, { keyPath: 'id' });
      },
    });
    return new IdbRepo(db);
  }

  async loadAll(): Promise<ZElement[]> {
    return (await this.db.getAll(STORE)) as ZElement[];
  }

  async save(changed: ZElement[], removedIds: string[]): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    for (const element of changed) tx.store.put(element);
    for (const id of removedIds) tx.store.delete(id);
    await tx.done;
  }
}
