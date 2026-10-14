import { openDb } from "./db/index.js";
import { startScheduler } from "./scheduler.js";

const handle = await openDb();
if (handle.embedded) {
  console.error("worker: DATABASE_URL is required; with embedded PGlite the scheduler runs inside the API process");
  process.exit(1);
}
const job = startScheduler(handle.db);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    job.stop();
    await handle.close();
    process.exit(0);
  });
}
