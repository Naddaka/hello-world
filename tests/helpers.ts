import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, runMigrations } from "@/db";

/** Fresh migrated + seeded DB in a temp dir. */
export function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "genhub-"));
  const { db, sqlite } = openDb(path.join(dir, "app.db"));
  runMigrations(db);
  return {
    db,
    dir,
    close() {
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
