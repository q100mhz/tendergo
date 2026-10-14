import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { filterKeys, orgTenderStates, tenders, type FilterKeyType, type TenderStatus } from "../db/schema.js";

export interface KeySet {
  okpd2: string[];
  ktru: string[];
  region: string[];
  customer: string[];
}

export async function loadKeys(db: DB, orgId: number): Promise<KeySet> {
  const rows = await db.select().from(filterKeys).where(eq(filterKeys.orgId, orgId));
  const keys: KeySet = { okpd2: [], ktru: [], region: [], customer: [] };
  for (const r of rows) keys[r.type as FilterKeyType].push(r.value);
  return keys;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function arrayPrefixMatch(column: typeof tenders.okpd2Codes | typeof tenders.ktruCodes, prefixes: string[]): SQL {
  const patterns = prefixes.map((p) => `${escapeLike(p)}%`);
  return sql`exists (select 1 from unnest(${column}) as c(code) where c.code like any(${sql.param(patterns)}::text[]))`;
}

/**
 * Keys combine as: (any OKPD2 or KTRU) AND (any region) AND (any customer).
 * Groups without keys don't restrict. OKPD2/KTRU match by prefix, so "26.20" covers all of 26.20.*.
 */
export function keysCondition(keys: KeySet): SQL | undefined {
  const parts: SQL[] = [];
  const product: SQL[] = [];
  if (keys.okpd2.length) product.push(arrayPrefixMatch(tenders.okpd2Codes, keys.okpd2));
  if (keys.ktru.length) product.push(arrayPrefixMatch(tenders.ktruCodes, keys.ktru));
  if (product.length) parts.push(or(...product)!);
  if (keys.region.length) parts.push(inArray(tenders.regionCode, keys.region));
  if (keys.customer.length) {
    const inns = keys.customer.filter((c) => /^\d{10}(\d{2})?$/.test(c));
    const names = keys.customer.filter((c) => !inns.includes(c));
    const c: SQL[] = [];
    if (inns.length) c.push(inArray(tenders.customerInn, inns));
    for (const n of names) c.push(ilike(tenders.customerName, `%${escapeLike(n)}%`));
    parts.push(or(...c)!);
  }
  return parts.length ? and(...parts) : undefined;
}

export const isEmptyKeySet = (k: KeySet) => !k.okpd2.length && !k.ktru.length && !k.region.length && !k.customer.length;

export interface TenderListQuery {
  scope: "keys" | "all";
  q?: string;
  law?: "44" | "223";
  priceMin?: number;
  priceMax?: number;
  activeOnly: boolean;
  favorite?: boolean;
  status?: TenderStatus;
  sort: "deadline" | "published" | "price";
  order: "asc" | "desc";
  page: number;
  pageSize: number;
}

export async function listTenders(db: DB, orgId: number, query: TenderListQuery) {
  const conds: (SQL | undefined)[] = [];
  let keys: KeySet | null = null;
  if (query.scope === "keys") {
    keys = await loadKeys(db, orgId);
    if (isEmptyKeySet(keys)) return { items: [], total: 0, noKeys: true };
    conds.push(keysCondition(keys));
  }
  if (query.q) {
    const like = `%${escapeLike(query.q)}%`;
    conds.push(or(ilike(tenders.title, like), ilike(tenders.customerName, like), ilike(tenders.regNumber, like)));
  }
  if (query.law) conds.push(eq(tenders.law, query.law));
  if (query.priceMin !== undefined) conds.push(gte(tenders.maxPrice, String(query.priceMin)));
  if (query.priceMax !== undefined) conds.push(lte(tenders.maxPrice, String(query.priceMax)));
  if (query.activeOnly) conds.push(or(gte(tenders.submissionDeadline, new Date()), sql`${tenders.submissionDeadline} is null`));
  if (query.favorite) conds.push(eq(orgTenderStates.favorite, true));
  if (query.status) {
    conds.push(
      query.status === "new"
        ? or(eq(orgTenderStates.status, "new"), sql`${orgTenderStates.status} is null`)
        : eq(orgTenderStates.status, query.status),
    );
  }
  const where = and(...conds);

  const sortCol =
    query.sort === "price" ? tenders.maxPrice : query.sort === "published" ? tenders.publishedAt : tenders.submissionDeadline;
  const dir = query.order === "asc" ? asc : desc;
  const join = and(eq(orgTenderStates.tenderId, tenders.id), eq(orgTenderStates.orgId, orgId));

  const items = await db
    .select({
      id: tenders.id,
      regNumber: tenders.regNumber,
      law: tenders.law,
      title: tenders.title,
      procedureType: tenders.procedureType,
      customerName: tenders.customerName,
      customerInn: tenders.customerInn,
      regionCode: tenders.regionCode,
      maxPrice: tenders.maxPrice,
      currency: tenders.currency,
      publishedAt: tenders.publishedAt,
      submissionDeadline: tenders.submissionDeadline,
      url: tenders.url,
      favorite: orgTenderStates.favorite,
      status: orgTenderStates.status,
    })
    .from(tenders)
    .leftJoin(orgTenderStates, join)
    .where(where)
    .orderBy(sql`${dir(sortCol)} nulls last`, desc(tenders.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(tenders)
    .leftJoin(orgTenderStates, join)
    .where(where);

  return {
    items: items.map((i) => ({ ...i, favorite: i.favorite ?? false, status: i.status ?? "new" })),
    total,
    noKeys: false,
  };
}
