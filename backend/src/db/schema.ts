import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type Role = "owner" | "admin" | "member";

export const memberships = pgTable(
  "memberships",
  {
    orgId: integer("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").$type<Exclude<Role, "owner">>().notNull(),
    token: text("token").notNull().unique(),
    invitedBy: integer("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("invitations_org_email_idx").on(t.orgId, t.email), index("invitations_email_idx").on(t.email)],
);

export type FilterKeyType = "okpd2" | "ktru" | "region" | "customer";

export const filterKeys = pgTable(
  "filter_keys",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").$type<FilterKeyType>().notNull(),
    value: text("value").notNull(),
    label: text("label"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("filter_keys_org_type_value_idx").on(t.orgId, t.type, t.value)],
);

export type Law = "44" | "223";

export const tenders = pgTable(
  "tenders",
  {
    id: serial("id").primaryKey(),
    regNumber: text("reg_number").notNull().unique(),
    law: text("law").$type<Law>().notNull(),
    title: text("title").notNull(),
    procedureType: text("procedure_type"),
    stage: text("stage"),
    customerName: text("customer_name"),
    customerInn: text("customer_inn"),
    regionCode: text("region_code"),
    maxPrice: numeric("max_price", { precision: 20, scale: 2 }),
    currency: text("currency").default("RUB"),
    publishedAt: ts("published_at"),
    sourceUpdatedAt: ts("source_updated_at"),
    submissionDeadline: ts("submission_deadline"),
    url: text("url").notNull(),
    okpd2Codes: text("okpd2_codes").array().notNull().default(sql`'{}'::text[]`),
    ktruCodes: text("ktru_codes").array().notNull().default(sql`'{}'::text[]`),
    details: jsonb("details").$type<Record<string, string>>(),
    detailsFetchedAt: ts("details_fetched_at"),
    sourceHash: text("source_hash"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("tenders_deadline_idx").on(t.submissionDeadline),
    index("tenders_region_idx").on(t.regionCode),
    index("tenders_customer_inn_idx").on(t.customerInn),
    index("tenders_okpd2_idx").using("gin", t.okpd2Codes),
    index("tenders_ktru_idx").using("gin", t.ktruCodes),
  ],
);

export type TenderStatus = "new" | "reviewing" | "applying" | "submitted" | "rejected";

export const orgTenderStates = pgTable(
  "org_tender_states",
  {
    orgId: integer("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tenderId: integer("tender_id")
      .notNull()
      .references(() => tenders.id, { onDelete: "cascade" }),
    favorite: boolean("favorite").notNull().default(false),
    status: text("status").$type<TenderStatus>().notNull().default("new"),
    note: text("note"),
    assigneeId: integer("assignee_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.tenderId] })],
);

export const ingestRuns = pgTable("ingest_runs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  status: text("status").$type<"running" | "ok" | "failed">().notNull(),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  fetched: integer("fetched").notNull().default(0),
  upserted: integer("upserted").notNull().default(0),
  error: text("error"),
});
