import Database from '@tauri-apps/plugin-sql';
import type { ZElement } from '../model/types';
import type { Repo } from './repo';

const DB_URL = 'sqlite:zadum.db';

interface Row {
  data: string;
}

const UPSERT = `INSERT INTO elements (id, parent_id, data, updated_at) VALUES ($1, $2, $3, $4)
  ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, data = excluded.data, updated_at = excluded.updated_at`;

/** Desktop storage: SQLite file in the app data directory, via the Tauri SQL plugin. */
export class SqliteRepo implements Repo {
  private constructor(private readonly db: Database) {}

  static async open(): Promise<SqliteRepo> {
    return new SqliteRepo(await Database.load(DB_URL));
  }

  async loadAll(): Promise<ZElement[]> {
    const rows = await this.db.select<Row[]>('SELECT data FROM elements');
    return rows.map((row) => JSON.parse(row.data) as ZElement);
  }

  async save(changed: ZElement[], removedIds: string[]): Promise<void> {
    // Each upsert is idempotent, so a batch interrupted midway is completed by the next save.
    for (const element of changed) {
      await this.db.execute(UPSERT, [element.id, element.parentId, JSON.stringify(element), element.updatedAt]);
    }
    for (const id of removedIds) {
      await this.db.execute('DELETE FROM elements WHERE id = $1', [id]);
    }
  }
}
