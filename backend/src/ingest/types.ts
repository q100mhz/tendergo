import type { Law } from "../db/schema.js";

export interface TenderRecord {
  regNumber: string;
  law: Law;
  title: string;
  procedureType: string | null;
  stage: string | null;
  customerName: string | null;
  customerInn: string | null;
  regionCode: string | null;
  maxPrice: string | null;
  currency: string | null;
  publishedAt: Date | null;
  sourceUpdatedAt: Date | null;
  submissionDeadline: Date | null;
  url: string;
  okpd2Codes: string[];
  ktruCodes: string[];
  /** Null when the notice page could not be loaded; previously stored details are then kept. */
  details: Record<string, string> | null;
  /** Hash of the search-card fields, used to skip re-fetching notices that have not changed. */
  fingerprint: string | null;
}

export interface FetchContext {
  /** True when the stored copy has the same fingerprint and its notice page was already loaded. */
  isUnchanged: (regNumber: string, fingerprint: string) => Promise<boolean>;
  log: (msg: string) => void;
}

export interface TenderSource {
  name: string;
  fetch(ctx: FetchContext): AsyncIterable<TenderRecord>;
}
