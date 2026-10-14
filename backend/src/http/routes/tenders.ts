import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../../db/index.js";
import { filterKeys, ingestRuns, memberships, orgTenderStates, tenders } from "../../db/schema.js";
import { REGIONS } from "../../lib/regions.js";
import { isEmptyKeySet, keysCondition, listTenders, loadKeys } from "../../services/tenderQuery.js";
import { HttpError, requireOrg } from "../auth.js";

const statusEnum = z.enum(["new", "reviewing", "applying", "submitted", "rejected"]);

const keyValue = {
  okpd2: z.string().regex(/^\d{2}(\.\d{1,3}){0,3}$/, "ОКПД2: формат 26.20 или 26.20.15.000"),
  ktru: z.string().regex(/^\d{2}\.\d{2}\.\d{2}\.\d{3}(-\d{1,8}(-\d+-\d+)?)?$/, "КТРУ: формат 26.20.15.000-00000027"),
  region: z.string().refine((v) => v in REGIONS, "Неизвестный регион"),
  customer: z.string().min(2, "Укажите ИНН или часть названия заказчика").max(300),
};

export function tenderRoutes(app: FastifyInstance, db: DB) {
  app.get("/api/meta/regions", async () => Object.entries(REGIONS).map(([code, name]) => ({ code, name })));

  app.get("/api/keys", async (req) => {
    const ctx = await requireOrg(db, req);
    return db.select().from(filterKeys).where(eq(filterKeys.orgId, ctx.orgId)).orderBy(asc(filterKeys.type), asc(filterKeys.value));
  });

  app.post("/api/keys", async (req) => {
    const ctx = await requireOrg(db, req, ["owner", "admin"]);
    const body = z
      .object({
        type: z.enum(["okpd2", "ktru", "region", "customer"]),
        value: z.string().trim().min(1),
        label: z.string().trim().max(300).optional(),
      })
      .parse(req.body);
    const value = keyValue[body.type].parse(body.value);
    const [row] = await db
      .insert(filterKeys)
      .values({ orgId: ctx.orgId, type: body.type, value, label: body.label || null })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new HttpError(409, "Такой ключ уже добавлен");
    return row;
  });

  app.delete<{ Params: { id: string } }>("/api/keys/:id", async (req) => {
    const ctx = await requireOrg(db, req, ["owner", "admin"]);
    await db.delete(filterKeys).where(and(eq(filterKeys.id, Number(req.params.id)), eq(filterKeys.orgId, ctx.orgId)));
    return { ok: true };
  });

  app.get("/api/tenders", async (req) => {
    const ctx = await requireOrg(db, req);
    const q = z
      .object({
        scope: z.enum(["keys", "all"]).default("keys"),
        q: z.string().trim().max(200).optional(),
        law: z.enum(["44", "223"]).optional(),
        priceMin: z.coerce.number().nonnegative().optional(),
        priceMax: z.coerce.number().nonnegative().optional(),
        activeOnly: z
          .enum(["true", "false"])
          .default("true")
          .transform((v) => v === "true"),
        favorite: z
          .enum(["true", "false"])
          .optional()
          .transform((v) => v === "true"),
        status: statusEnum.optional(),
        sort: z.enum(["deadline", "published", "price"]).default("deadline"),
        order: z.enum(["asc", "desc"]).default("asc"),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(req.query);
    const result = await listTenders(db, ctx.orgId, { ...q, q: q.q || undefined });
    return { ...result, page: q.page, pageSize: q.pageSize };
  });

  app.get<{ Params: { id: string } }>("/api/tenders/:id", async (req) => {
    const ctx = await requireOrg(db, req);
    const id = Number(req.params.id);
    const [tender] = await db.select().from(tenders).where(eq(tenders.id, id));
    if (!tender) throw new HttpError(404, "Закупка не найдена");
    const [state] = await db
      .select()
      .from(orgTenderStates)
      .where(and(eq(orgTenderStates.orgId, ctx.orgId), eq(orgTenderStates.tenderId, id)));
    const keys = await loadKeys(db, ctx.orgId);
    let matchesKeys = false;
    if (!isEmptyKeySet(keys)) {
      const [hit] = await db
        .select({ id: tenders.id })
        .from(tenders)
        .where(and(eq(tenders.id, id), keysCondition(keys)));
      matchesKeys = !!hit;
    }
    return {
      tender: { ...tender, regionName: tender.regionCode ? (REGIONS[tender.regionCode] ?? null) : null },
      state: {
        favorite: state?.favorite ?? false,
        status: state?.status ?? "new",
        note: state?.note ?? null,
        assigneeId: state?.assigneeId ?? null,
      },
      matchesKeys,
    };
  });

  app.put<{ Params: { id: string } }>("/api/tenders/:id/state", async (req) => {
    const ctx = await requireOrg(db, req);
    const id = Number(req.params.id);
    const body = z
      .object({
        favorite: z.boolean().optional(),
        status: statusEnum.optional(),
        note: z.string().max(5000).nullable().optional(),
        assigneeId: z.number().int().nullable().optional(),
      })
      .parse(req.body);
    const [tender] = await db.select({ id: tenders.id }).from(tenders).where(eq(tenders.id, id));
    if (!tender) throw new HttpError(404, "Закупка не найдена");
    if (body.assigneeId) {
      const [m] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, body.assigneeId)));
      if (!m) throw new HttpError(400, "Ответственный должен быть сотрудником организации");
    }
    const patch = { ...body, note: body.note === "" ? null : body.note, updatedAt: new Date() };
    await db
      .insert(orgTenderStates)
      .values({ orgId: ctx.orgId, tenderId: id, ...patch })
      .onConflictDoUpdate({ target: [orgTenderStates.orgId, orgTenderStates.tenderId], set: patch });
    return { ok: true };
  });

  app.get("/api/ingest/status", async (req) => {
    await requireOrg(db, req);
    const runs = await db.select().from(ingestRuns).orderBy(desc(ingestRuns.startedAt)).limit(5);
    return { runs };
  });
}
