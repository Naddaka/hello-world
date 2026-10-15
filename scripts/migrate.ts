import { openDb, runMigrations } from "../src/db";
import { config } from "../src/lib/config";

const { db, sqlite } = openDb(config.dbPath);
runMigrations(db);
sqlite.close();
console.log(`Migrations applied: ${config.dbPath}`);
