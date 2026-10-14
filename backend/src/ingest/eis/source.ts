import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { FetchContext, TenderRecord, TenderSource } from "../types.js";
import { parseNoticePage, parseSearchPage, type SearchCard } from "./parse.js";

export interface EisOptions {
  baseUrl: string;
  delayMs: number;
  maxPages: number;
}

const PAGE_SIZE = 50;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "ru-RU,ru;q=0.9",
  Accept: "text/html,application/xhtml+xml",
};

export function searchUrl(baseUrl: string, page: number): string {
  const params = new URLSearchParams({
    morphology: "on",
    pageNumber: String(page),
    sortDirection: "false",
    recordsPerPage: `_${PAGE_SIZE}`,
    showLotsInfoHidden: "false",
    sortBy: "UPDATE_DATE",
    fz44: "on",
    fz223: "on",
    af: "on",
    currencyIdGeneral: "-1",
  });
  return `${baseUrl}/epz/order/extendedsearch/results.html?${params}`;
}

export function cardFingerprint(c: SearchCard): string {
  const parts = [
    c.title,
    c.stage,
    c.procedureType,
    c.customerName,
    c.maxPrice,
    c.publishedAt?.toISOString(),
    c.sourceUpdatedAt?.toISOString(),
    c.submissionDeadline?.toISOString(),
  ];
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex");
}

export class EisSource implements TenderSource {
  name = "eis";
  private lastRequest = 0;

  constructor(private opts: EisOptions) {}

  private async get(url: string): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = this.lastRequest + this.opts.delayMs * (attempt + 1) - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastRequest = Date.now();
      try {
        const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
        if (res.ok) return await res.text();
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        if (res.status < 500 && res.status !== 429) break;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  private async details(card: SearchCard): Promise<Partial<TenderRecord>> {
    const main = parseNoticePage(await this.get(card.url));
    let lots: ReturnType<typeof parseNoticePage> | null = null;
    // 223-ФЗ notices list ОКПД2 codes on a separate lots tab.
    if (card.law === "223" && card.url.includes("common-info")) {
      try {
        lots = parseNoticePage(await this.get(card.url.replace("common-info", "lot-list")));
      } catch {
        lots = null;
      }
    }
    return {
      submissionDeadline: main.submissionDeadline ?? card.submissionDeadline,
      maxPrice: card.maxPrice ?? main.maxPrice,
      customerName: main.customerName ?? card.customerName,
      customerInn: main.customerInn,
      regionCode: main.regionCode,
      okpd2Codes: [...new Set([...main.okpd2Codes, ...(lots?.okpd2Codes ?? [])])].sort(),
      ktruCodes: [...new Set([...main.ktruCodes, ...(lots?.ktruCodes ?? [])])].sort(),
      details: main.pairs,
    };
  }

  /**
   * Scans the newest EIS_MAX_PAGES pages of "Подача заявок", sorted by update date. Cards only show the
   * update *date*, so there is no reliable point to stop earlier; unchanged cards are skipped by fingerprint.
   */
  async *fetch(ctx: FetchContext): AsyncIterable<TenderRecord> {
    let pages = 0;
    let scanned = 0;
    let changed = 0;
    let changedOnLastPage = 0;
    for (let page = 1; page <= this.opts.maxPages; page++) {
      const cards = parseSearchPage(await this.get(searchUrl(this.opts.baseUrl, page)), this.opts.baseUrl);
      if (cards.length === 0) break;
      pages++;
      scanned += cards.length;
      changedOnLastPage = 0;

      for (const card of cards) {
        const fingerprint = cardFingerprint(card);
        if (await ctx.isUnchanged(card.regNumber, fingerprint)) continue;
        changed++;
        changedOnLastPage++;
        const base: TenderRecord = {
          ...card,
          customerInn: null,
          regionCode: null,
          currency: "RUB",
          okpd2Codes: [],
          ktruCodes: [],
          details: null,
          fingerprint,
        };
        try {
          yield { ...base, ...(await this.details(card)) };
        } catch (err) {
          ctx.log(`eis: notice ${card.regNumber} failed, will retry next run: ${String(err)}`);
          yield base;
        }
      }
      ctx.log(`eis: page ${page}: ${cards.length} cards, ${changedOnLastPage} new or changed`);
      if (cards.length < PAGE_SIZE) break;
    }
    ctx.log(`eis: scanned ${scanned} cards on ${pages} pages, ${changed} new or changed`);
    if (pages === this.opts.maxPages && changedOnLastPage === PAGE_SIZE) {
      ctx.log(
        "eis: WARNING every card on the last page was new; unless this is the first run, hourly updates " +
          "do not fit into EIS_MAX_PAGES pages — raise it",
      );
    }
  }
}
