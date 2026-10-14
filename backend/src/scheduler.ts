import { Cron } from "croner";
import { config } from "./config.js";
import type { DB } from "./db/index.js";
import { createSource, runIngest } from "./ingest/run.js";

export function startScheduler(db: DB, log: (m: string) => void = console.log) {
  const source = createSource();
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runIngest(db, source, log);
    } catch (err) {
      log(`ingest: unexpected error ${String(err)}`);
    } finally {
      busy = false;
    }
  };
  const job = new Cron(config.INGEST_CRON, { timezone: "Europe/Moscow" }, tick);
  log(`scheduler: source=${source.name}, cron="${config.INGEST_CRON}", next=${job.nextRun()?.toISOString()}`);
  if (config.INGEST_ON_START) void tick();
  return job;
}
