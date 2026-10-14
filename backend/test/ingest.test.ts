import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DbHandle } from "../src/db/index.js";
import { openTestDb } from "./db.js";
import { tenders } from "../src/db/schema.js";
import { EisSource } from "../src/ingest/eis/source.js";
import { runIngest } from "../src/ingest/run.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/eis/${name}`, import.meta.url), "utf8");
const REG = "0348300169726000011";

let handle: DbHandle;
let searchHtml = fixture("search-results.html");
let failingNotice: string | null = null;
const requested: string[] = [];

function fakeEis(url: string): Response {
  requested.push(url);
  if (url.includes("extendedsearch")) {
    return new Response(new URL(url).searchParams.get("pageNumber") === "1" ? searchHtml : "<html></html>");
  }
  if (failingNotice && url.includes(failingNotice)) return new Response("down", { status: 503 });
  if (url.includes("notice223/lot-list")) return new Response(fixture("notice223-lots.html"));
  if (url.includes("notice223")) return new Response(fixture("notice223.html"));
  return new Response(fixture("notice44.html"));
}

const source = () => new EisSource({ baseUrl: "https://zakupki.gov.ru", delayMs: 0, maxPages: 3 });
// The archived notices closed long ago, so retention must not purge them between runs.
const ingest = () => runIngest(handle.db, source(), () => {}, { retentionDays: 100_000 });
const stored = async () => (await handle.db.select().from(tenders).where(eq(tenders.regNumber, REG)))[0]!;

beforeAll(async () => {
  handle = await openTestDb();
  vi.stubGlobal("fetch", async (input: string | URL) => fakeEis(String(input)));
});
afterEach(() => {
  requested.length = 0;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await handle.close();
});

describe("EIS ingestion", () => {
  it("loads every card with its notice", async () => {
    const r = await ingest();
    expect(r).toMatchObject({ status: "ok", upserted: 10 });
    const t = await stored();
    expect(t).toMatchObject({
      law: "44",
      maxPrice: "29405059.68",
      customerName: "КОМИТЕТ РЕСПУБЛИКИ ТАТАРСТАН ПО ОХРАНЕ ОБЪЕКТОВ КУЛЬТУРНОГО НАСЛЕДИЯ",
      customerInn: "1655405560",
      regionCode: "16",
      okpd2Codes: ["72.20.29.110"],
    });
    expect(t.submissionDeadline?.toISOString()).toBe("2026-05-12T04:00:00.000Z");
    const lots = requested.filter((u) => u.includes("lot-list"));
    expect(lots).toHaveLength(2);
  });

  it("does not re-fetch unchanged notices", async () => {
    const r = await ingest();
    expect(r).toMatchObject({ status: "ok", fetched: 0 });
    expect(requested.every((u) => u.includes("extendedsearch"))).toBe(true);
  });

  it("keeps notice data when the notice page fails and retries next run", async () => {
    const before = await stored();
    searchHtml = searchHtml.replace("29&nbsp;405&nbsp;059,68", "30&nbsp;000&nbsp;000,00");
    failingNotice = REG;
    expect(await ingest()).toMatchObject({ status: "ok", fetched: 1 });

    const after = await stored();
    expect(after.maxPrice).toBe("30000000.00");
    expect(after.customerName).toBe(before.customerName);
    expect(after.submissionDeadline?.toISOString()).toBe("2026-05-12T04:00:00.000Z");
    expect(after.okpd2Codes).toEqual(before.okpd2Codes);
    expect(after.sourceHash).toBe(before.sourceHash);

    failingNotice = null;
    expect(await ingest()).toMatchObject({ status: "ok", fetched: 1 });
    expect((await stored()).sourceHash).not.toBe(before.sourceHash);
  });

  it("marks the run failed when the search page is unavailable", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    const r = await ingest();
    expect(r.status).toBe("failed");
    vi.stubGlobal("fetch", async (input: string | URL) => fakeEis(String(input)));
  });
});
