import { config } from "./config.js";
import { openDb } from "./db/index.js";
import { buildApp } from "./http/app.js";
import { startScheduler } from "./scheduler.js";

const handle = await openDb();
const app = await buildApp(handle.db, { logger: true });

// Embedded PGlite allows a single process, so the scheduler runs in-process in local development.
if (handle.embedded) startScheduler(handle.db, (m) => app.log.info(m));

await app.listen({ port: config.PORT, host: config.HOST });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    await app.close();
    await handle.close();
    process.exit(0);
  });
}
