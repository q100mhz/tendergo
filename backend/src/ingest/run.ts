import { and, eq, lt, sql } from "drizzle-orm";
import { config } from "../config.js";
import type { DB } from "../db/index.js";
import { ingestRuns, orgTenderStates, tenders } from "../db/schema.js";
import { EisSource } from "./eis/source.js";
import { MockSource } from "./mock.js";
import type { TenderRecord, TenderSource } from "./types.js";

export function createSource(): TenderSource {
  if (config.TENDER_SOURCE === "mock") return new MockSource();
  return new EisSource({ baseUrl: config.EIS_BASE_URL, delayMs: config.EIS_DELAY_MS, maxPages: config.EIS_MAX_PAGES });
}

export async function upsertTender(db: DB, r: TenderRecord): Promise<void> {
  const cardFields = {
    law: r.law,
    title: r.title || "(без названия)",
    procedureType: r.procedureType,
    stage: r.stage,
    maxPrice: r.maxPrice,
    currency: r.currency,
    publishedAt: r.publishedAt,
    sourceUpdatedAt: r.sourceUpdatedAt,
    url: r.url,
  };
  const noticeFields = {
    customerName: r.customerName,
    customerInn: r.customerInn,
    regionCode: r.regionCode,
    submissionDeadline: r.submissionDeadline,
    okpd2Codes: r.okpd2Codes,
    ktruCodes: r.ktruCodes,
    details: r.details,
    detailsFetchedAt: r.details ? new Date() : null,
    sourceHash: r.fingerprint,
  };
  // Without the notice page only card fields are refreshed: the card has no deadline time, often names the
  // authorized body instead of the customer, and keeping the old hash makes the next run retry the notice.
  const set = r.details ? { ...cardFields, ...noticeFields } : cardFields;
  await db
    .insert(tenders)
    .values({ regNumber: r.regNumber, ...cardFields, ...noticeFields })
    .onConflictDoUpdate({ target: tenders.regNumber, set: { ...set, updatedAt: new Date() } });
}

export interface RunResult {
  status: "ok" | "failed" | "skipped";
  fetched: number;
  upserted: number;
  purged: number;
  error?: string;
}

export async function runIngest(
  db: DB,
  source: TenderSource,
  log: (m: string) => void = console.log,
  opts: { retentionDays?: number } = {},
): Promise<RunResult> {
  const staleRunning = new Date(Date.now() - 3 * 3600_000);
  await db
    .update(ingestRuns)
    .set({ status: "failed", error: "abandoned", finishedAt: new Date() })
    .where(and(eq(ingestRuns.status, "running"), lt(ingestRuns.startedAt, staleRunning)));

  const [running] = await db.select().from(ingestRuns).where(eq(ingestRuns.status, "running")).limit(1);
  if (running) {
    log(`ingest: run #${running.id} still in progress, skipping`);
    return { status: "skipped", fetched: 0, upserted: 0, purged: 0 };
  }

  const [run] = await db.insert(ingestRuns).values({ source: source.name, status: "running" }).returning();
  let fetched = 0;
  let upserted = 0;
  try {
    for await (const record of source.fetch({
      log,
      isUnchanged: async (regNumber, fingerprint) => {
        const [row] = await db
          .select({ hash: tenders.sourceHash, fetchedAt: tenders.detailsFetchedAt })
          .from(tenders)
          .where(eq(tenders.regNumber, regNumber));
        return !!row?.fetchedAt && row.hash === fingerprint;
      },
    })) {
      fetched++;
      await upsertTender(db, record);
      upserted++;
    }
    const purged = await purgeExpired(db, opts.retentionDays ?? config.RETENTION_DAYS);
    await db
      .update(ingestRuns)
      .set({ status: "ok", finishedAt: new Date(), fetched, upserted })
      .where(eq(ingestRuns.id, run!.id));
    log(`ingest: ok, fetched=${fetched} upserted=${upserted} purged=${purged}`);
    return { status: "ok", fetched, upserted, purged };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db
      .update(ingestRuns)
      .set({ status: "failed", finishedAt: new Date(), fetched, upserted, error })
      .where(eq(ingestRuns.id, run!.id));
    log(`ingest: failed after ${upserted} records: ${error}`);
    return { status: "failed", fetched, upserted, purged: 0, error };
  }
}

/** Deletes tenders whose deadline passed long ago, unless some organization has marked them. */
export async function purgeExpired(db: DB, days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const deleted = await db
    .delete(tenders)
    .where(
      and(
        lt(tenders.submissionDeadline, cutoff),
        sql`not exists (
          select 1 from ${orgTenderStates} s
          where s.tender_id = ${tenders.id}
            and (s.favorite or s.status <> 'new' or s.note is not null or s.assignee_id is not null)
        )`,
      ),
    )
    .returning({ id: tenders.id });
  return deleted.length;
}
