import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb, runMigrations } from "@/db";
import { jobs, models } from "@/db/schema";

describe("migrations", () => {
  it("create tables on an empty DB and are idempotent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "genhub-"));
    const { db, sqlite } = openDb(path.join(dir, "app.db"));
    runMigrations(db);
    runMigrations(db);

    db.insert(models)
      .values({ id: "m", provider: "mock", providerModelId: "m", name: "M", type: "image", priceUnit: "per_image", priceUsd: 0.01 })
      .run();
    db.insert(jobs).values({ id: "j", modelId: "m", prompt: "cat", params: { n: 1 } }).run();

    const job = db.select().from(jobs).get()!;
    expect(job.status).toBe("queued");
    expect(job.params).toEqual({ n: 1 });
    expect(job.createdAt).toBeInstanceOf(Date);
    sqlite.close();
    fs.rmSync(dir, { recursive: true });
  });
});
