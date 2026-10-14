import { randomUUID } from "node:crypto";
import pg from "pg";
import { openDb, type DbHandle } from "../src/db/index.js";

/** Embedded PGlite by default; a fresh database on a real PostgreSQL when TEST_DATABASE_URL is set (CI). */
export async function openTestDb(): Promise<DbHandle> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDb({ memory: true });
  const name = `test_${randomUUID().replace(/-/g, "")}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const dbUrl = new URL(url);
  dbUrl.pathname = `/${name}`;
  const handle = await openDb({ url: dbUrl.toString() });
  return {
    ...handle,
    close: async () => {
      await handle.close();
      const cleanup = new pg.Client({ connectionString: url });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${name}`);
      await cleanup.end();
    },
  };
}
