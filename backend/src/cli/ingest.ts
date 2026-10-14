import { openDb } from "../db/index.js";
import { createSource, runIngest } from "../ingest/run.js";

const handle = await openDb();
const result = await runIngest(handle.db, createSource());
await handle.close();
process.exit(result.status === "failed" ? 1 : 0);
