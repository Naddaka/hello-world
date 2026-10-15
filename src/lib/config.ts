import path from "node:path";

/** Server-side configuration read from the environment at call time. */
export const config = {
  get dataDir() {
    // Runtime path, not a build input: keep the bundler from tracing it.
    return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "./data");
  },
  get dbPath() {
    return path.join(this.dataDir, "app.db");
  },
  get providerMode(): "mock" | "real" {
    return process.env.PROVIDER_MODE === "real" ? "real" : "mock";
  },
  get timezone() {
    return process.env.APP_TIMEZONE || "Europe/Kyiv";
  },
};
