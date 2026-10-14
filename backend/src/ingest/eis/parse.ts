import * as cheerio from "cheerio";
import type { Law } from "../../db/schema.js";
import { mskOffset, regionFromInn, regionFromText } from "../../lib/regions.js";

type Doc = cheerio.CheerioAPI;

const clean = (s: string | undefined | null) => (s ?? "").replace(/[\s ]+/g, " ").trim();

/**
 * "14.10.2026", "14.10.2026 10:00 (МСК)", "14.10.2026 10:00 (МСК+4)" → UTC Date.
 * Values without an explicit МСК marker are read with `defaultMskOffset` (hours ahead of Moscow).
 */
export function parseEisDate(input: string | null | undefined, defaultMskOffset = 0): Date | null {
  const s = clean(input);
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = "0", mi = "0"] = m;
  let offset = defaultMskOffset;
  const marker = s.match(/МСК\s*(?:([+\-−])\s*(\d+))?/i);
  if (marker) offset = marker[1] ? (marker[1] === "+" ? 1 : -1) * Number(marker[2]) : 0;
  return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh) - 3 - offset, Number(mi)));
}

/** "1 234 567,89 ₽" → "1234567.89" */
export function parseEisPrice(input: string | null | undefined): string | null {
  const s = clean(input).replace(/\s/g, "");
  const m = s.match(/(\d+(?:,\d{1,2})?)/);
  if (!m) return null;
  return m[1]!.replace(",", ".");
}

export function detectLaw(text: string, regNumber: string): Law {
  if (/223-ФЗ/i.test(text)) return "223";
  if (/44-ФЗ/i.test(text)) return "44";
  return regNumber.length === 11 ? "223" : "44";
}

export interface SearchCard {
  regNumber: string;
  law: Law;
  procedureType: string | null;
  stage: string | null;
  title: string;
  customerName: string | null;
  maxPrice: string | null;
  publishedAt: Date | null;
  /** Date only: the search results show no time of the update. */
  sourceUpdatedAt: Date | null;
  submissionDeadline: Date | null;
  url: string;
}

function labelled(pairs: Map<string, string>, re: RegExp): string | null {
  for (const [k, v] of pairs) if (re.test(k)) return v;
  return null;
}

export function parseSearchPage(html: string, baseUrl: string): SearchCard[] {
  const $ = cheerio.load(html);
  const cards: SearchCard[] = [];
  $(".search-registry-entry-block").each((_, el) => {
    const card = $(el);
    const numberLink = card.find(".registry-entry__header-mid__number a").first();
    const regNumber = clean(numberLink.text()).replace(/^№\s*/, "");
    const href = numberLink.attr("href");
    if (!regNumber || !href) return;
    const url = new URL(href, baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return;

    const pairs = new Map<string, string>();
    card.find(".registry-entry__body-title").each((_, t) => {
      const title = clean($(t).text());
      const value = $(t).nextAll(".registry-entry__body-value, .registry-entry__body-href").first();
      if (title) pairs.set(title, clean(value.text()));
    });
    card.find(".data-block__title").each((_, t) => {
      const title = clean($(t).text());
      if (title) pairs.set(title, clean($(t).nextAll(".data-block__value").first().text()));
    });

    const header = clean(card.find(".registry-entry__header-top__title").text());
    cards.push({
      regNumber,
      law: detectLaw(header, regNumber),
      procedureType: clean(header.replace(/\d+-ФЗ/, "")) || null,
      stage: clean(card.find(".registry-entry__header-mid__title").text()) || null,
      title: labelled(pairs, /объект закупки|наименование/i) ?? "",
      // For 44-ФЗ this is often the authorized body rather than the customer; the notice page refines it.
      customerName: labelled(pairs, /заказчик|организация/i),
      maxPrice: parseEisPrice(card.find(".price-block__value").first().text()),
      publishedAt: parseEisDate(labelled(pairs, /размещено/i)),
      sourceUpdatedAt: parseEisDate(labelled(pairs, /обновлено/i)),
      submissionDeadline: parseEisDate(labelled(pairs, /окончание подачи/i)),
      url: url.toString(),
    });
  });
  return cards;
}

export interface NoticeDetails {
  pairs: Record<string, string>;
  submissionDeadline: Date | null;
  maxPrice: string | null;
  customerName: string | null;
  customerInn: string | null;
  regionCode: string | null;
  okpd2Codes: string[];
  ktruCodes: string[];
}

const KTRU_RE = /(?<![\d.])\d{2}\.\d{2}\.\d{2}\.\d{3}-\d{6,8}(?:-\d{1,13}){0,4}(?![\d-])/g;
const OKPD2_FULL_RE = /(?<![\d.])\d{2}\.\d{2}\.\d{2}\.\d{3}(?![\d.]|-\d)/g;
const OKPD2_ANY_RE = /(?<![\d.])\d{2}\.\d{1,2}(?:\.\d{1,2}(?:\.\d{1,3})?)?(?![\d.]|-\d)/g;
const OKPD2_LABELLED_RE = /ОКПД\s*2?\)?\s*[:\-–]?\s*(\d{2}(?:\.\d{1,3}){1,3})(?![\d.-])/g;
const CODE_COLUMN_RE = /ОКПД|КТРУ|Код позиции/i;

/** Text of table cells under "Код позиции" / "Классификация по ОКПД2" headers (not ОКВЭД2). */
function codeColumnTexts($: Doc): string[] {
  const out: string[] = [];
  $("table").each((_, table) => {
    const rows = $(table).children("thead, tbody").children("tr").add($(table).children("tr"));
    const headerRow = rows.filter((_, tr) => $(tr).children("th").length > 0).first();
    if (!headerRow.length) return;
    const codeCols = new Set<number>();
    let width = 0;
    headerRow.children("th").each((_, th) => {
      const text = clean($(th).text());
      if (CODE_COLUMN_RE.test(text) && !/ОКВЭД/i.test(text)) codeCols.add(width);
      width += Number($(th).attr("colspan") ?? 1);
    });
    if (!codeCols.size) return;
    rows.each((_, tr) => {
      const cells = $(tr).children("td");
      if (!cells.length) return;
      const spans = cells.map((_, td) => Number($(td).attr("colspan") ?? 1)).get() as number[];
      // Position tables in 44-ФЗ notices have an extra leading cell (the expand toggle) not covered by headers.
      let col = -Math.max(0, spans.reduce((a, b) => a + b, 0) - width);
      cells.each((i, td) => {
        if (codeCols.has(col)) out.push(clean($(td).text()));
        col += spans[i]!;
      });
    });
  });
  return out;
}

function extractCodes($: Doc, pageText: string): { okpd2: string[]; ktru: string[] } {
  const ktru = new Set<string>(pageText.match(KTRU_RE) ?? []);
  const okpd2 = new Set<string>(pageText.match(OKPD2_FULL_RE) ?? []);
  for (const m of pageText.matchAll(OKPD2_LABELLED_RE)) okpd2.add(m[1]!);
  for (const cell of codeColumnTexts($)) {
    for (const k of cell.match(KTRU_RE) ?? []) ktru.add(k);
    for (const c of cell.match(OKPD2_ANY_RE) ?? []) okpd2.add(c);
  }
  for (const k of ktru) okpd2.add(k.slice(0, 12));
  return { okpd2: [...okpd2].sort(), ktru: [...ktru].sort() };
}

/** The ИКЗ embeds the customer's ИНН at positions 4–13, also when an authorized body places the order. */
export function innFromIkz(ikz: string | null | undefined): string | null {
  const digits = (ikz ?? "").replace(/\D/g, "");
  if (digits.length !== 36) return null;
  const inn = digits.slice(3, 13);
  return /^0+$/.test(inn) ? null : inn;
}

export function parseNoticePage(html: string): NoticeDetails {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();

  const pairs: Record<string, string> = {};
  const add = (k: string, v: string) => {
    const key = clean(k).replace(/:$/, "");
    const val = clean(v);
    if (key && val && key.length < 200 && !(key in pairs) && Object.keys(pairs).length < 80) {
      pairs[key] = val.slice(0, 2000);
    }
  };
  $(".section__title").each((_, t) => add($(t).text(), $(t).nextAll(".section__info").first().text()));
  $(".common-text__title").each((_, t) => add($(t).text(), $(t).nextAll(".common-text__value").first().text()));
  $("tr").each((_, tr) => {
    const cells = $(tr).children("td");
    if (cells.length === 2) add($(cells[0]).text(), $(cells[1]).text());
  });

  const entry = (re: RegExp): [string, string] | null => {
    for (const kv of Object.entries(pairs)) if (re.test(kv[0])) return kv;
    return null;
  };
  const find = (re: RegExp) => entry(re)?.[1] ?? null;
  const text = clean($("body").text());

  const placedByCustomer = find(/^Размещение осуществляет/i)?.match(/^Заказчик\s+(.+)/i)?.[1];
  const requirementsOf = text.match(/Требования заказчика\s*«([^»]{3,300})»/)?.[1];
  const customerName =
    placedByCustomer ??
    requirementsOf ??
    find(/^(Наименование организации|Наименование заказчика|Заказчик)$/i) ??
    find(/^Организация, осуществляющая размещение/i);

  const customerInn =
    innFromIkz(find(/Идентификационный код закупки/i) ?? text.match(/\(ИКЗ\)\s*(\d{36})/)?.[1]) ??
    find(/^ИНН/i)?.match(/\d{10}(?:\d{2})?/)?.[0] ??
    text.match(/ИНН\s*:?\s*(\d{10}(?:\d{2})?)\b/)?.[1] ??
    null;

  const regionCode =
    regionFromText(find(/^Регион$/i)) ??
    regionFromInn(customerInn) ??
    regionFromText(find(/место нахождения|почтовый адрес/i));

  // 223-ФЗ notices state the deadline "по местному времени заказчика" without a МСК marker.
  const deadline = entry(/окончани\S*\s+(срока\s+)?подачи/i);
  const submissionDeadline = deadline
    ? parseEisDate(deadline[1], /местн/i.test(deadline[0]) ? mskOffset(regionCode) : 0)
    : null;

  const codes = extractCodes($, text);
  return {
    pairs,
    submissionDeadline,
    maxPrice: parseEisPrice(find(/начальная.*цен|нмц/i)),
    customerName,
    customerInn,
    regionCode,
    okpd2Codes: codes.okpd2,
    ktruCodes: codes.ktru,
  };
}
