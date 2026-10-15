import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { config } from "@/lib/config";
import * as schema from "./schema";
import { seedModels } from "./seed";

export type Db = BetterSQLite3Database<typeof schema>;

export function openDb(file: string): { db: Db; sqlite: Database.Database } {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  return { db: drizzle(sqlite, { schema }), sqlite };
}

export function runMigrations(db: Db) {
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  seedModels(db);
}

// One connection per process; survives Next dev hot reloads.
const g = globalThis as unknown as { __db?: Db };

export function getDb(): Db {
  if (!g.__db) {
    const { db } = openDb(config.dbPath);
    runMigrations(db);
    g.__db = db;
  }
  return g.__db;
}
