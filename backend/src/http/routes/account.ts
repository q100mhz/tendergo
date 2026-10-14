import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { config } from "../../config.js";
import type { DB } from "../../db/index.js";
import { invitations, memberships, organizations, users } from "../../db/schema.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { clearSession, HttpError, readSession, requireOrg, requireUser, setSession } from "../auth.js";

const email = z.string().trim().toLowerCase().email("Некорректный email").max(200);
const password = z.string().min(8, "Пароль — минимум 8 символов").max(200);
const orgName = z.string().trim().min(2, "Название — минимум 2 символа").max(200);

const inviteLink = (token: string) => `${config.PUBLIC_URL}/register?invite=${token}`;

async function userOrgs(db: DB, userId: number) {
  return db
    .select({ id: organizations.id, name: organizations.name, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
}

async function createOrg(db: DB, userId: number, name: string): Promise<number> {
  const [org] = await db.insert(organizations).values({ name }).returning({ id: organizations.id });
  await db.insert(memberships).values({ orgId: org!.id, userId, role: "owner" });
  return org!.id;
}

async function findInvitation(db: DB, token: string, email: string) {
  const [inv] = await db.select().from(invitations).where(eq(invitations.token, token));
  if (!inv) throw new HttpError(404, "Приглашение не найдено или уже использовано");
  if (inv.email !== email) throw new HttpError(403, `Приглашение выписано на ${inv.email}`);
  return inv;
}

async function acceptInvitation(db: DB, inv: typeof invitations.$inferSelect, userId: number) {
  await db.insert(memberships).values({ orgId: inv.orgId, userId, role: inv.role }).onConflictDoNothing();
  await db.delete(invitations).where(eq(invitations.id, inv.id));
}

export function accountRoutes(app: FastifyInstance, db: DB) {
  app.post("/api/auth/register", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z
      .object({
        email,
        password,
        name: z.string().trim().min(1, "Укажите имя").max(200),
        orgName: orgName.optional(),
        inviteToken: z.string().max(100).optional(),
      })
      .parse(req.body);

    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email));
    if (exists) throw new HttpError(409, "Пользователь с таким email уже зарегистрирован");

    // Emails are not verified, so joining a workspace requires the invitation link itself, not just a matching email.
    const invitation = body.inviteToken ? await findInvitation(db, body.inviteToken, body.email) : null;

    const [user] = await db
      .insert(users)
      .values({ email: body.email, name: body.name, passwordHash: await hashPassword(body.password) })
      .returning({ id: users.id });
    const userId = user!.id;

    let orgId: number;
    if (invitation) {
      await acceptInvitation(db, invitation, userId);
      orgId = invitation.orgId;
    } else {
      orgId = await createOrg(db, userId, body.orgName ?? `Организация ${body.name}`);
    }

    await setSession(app, reply, { uid: userId, oid: orgId });
    return { ok: true };
  });

  app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({ email, password: z.string().min(1) }).parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, body.email));
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new HttpError(401, "Неверный email или пароль");
    }
    const orgs = await userOrgs(db, user.id);
    await setSession(app, reply, { uid: user.id, oid: orgs[0]?.id ?? null });
    return { ok: true };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    clearSession(reply);
    return { ok: true };
  });

  app.get("/api/me", async (req, reply) => {
    const s = await readSession(req);
    if (!s) throw new HttpError(401, "Требуется вход");
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, s.uid));
    if (!user) {
      clearSession(reply);
      throw new HttpError(401, "Требуется вход");
    }
    const orgs = await userOrgs(db, user.id);
    let current = orgs.find((o) => o.id === s.oid) ?? null;
    if (!current && orgs[0]) {
      current = orgs[0];
      await setSession(app, reply, { uid: user.id, oid: current.id });
    }
    return { user, org: current, orgs };
  });

  app.post("/api/orgs", async (req, reply) => {
    const s = await requireUser(req);
    const body = z.object({ name: orgName }).parse(req.body);
    const orgId = await createOrg(db, s.uid, body.name);
    await setSession(app, reply, { uid: s.uid, oid: orgId });
    return { id: orgId };
  });

  app.post("/api/orgs/switch", async (req, reply) => {
    const s = await requireUser(req);
    const body = z.object({ orgId: z.number().int() }).parse(req.body);
    const [m] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, s.uid), eq(memberships.orgId, body.orgId)));
    if (!m) throw new HttpError(403, "Нет доступа к организации");
    await setSession(app, reply, { uid: s.uid, oid: body.orgId });
    return { ok: true };
  });

  app.patch("/api/orgs/current", async (req) => {
    const ctx = await requireOrg(db, req, ["owner", "admin"]);
    const body = z.object({ name: orgName }).parse(req.body);
    await db.update(organizations).set({ name: body.name }).where(eq(organizations.id, ctx.orgId));
    return { ok: true };
  });

  app.get("/api/orgs/current/members", async (req) => {
    const ctx = await requireOrg(db, req);
    const members = await db
      .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, ctx.orgId))
      .orderBy(asc(memberships.createdAt));
    const canManage = ctx.role !== "member";
    const invites = canManage
      ? (await db.select().from(invitations).where(eq(invitations.orgId, ctx.orgId))).map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          link: inviteLink(i.token),
        }))
      : [];
    return { members, invitations: invites, myRole: ctx.role, myUserId: ctx.userId };
  });

  app.post("/api/orgs/current/invitations", async (req) => {
    const ctx = await requireOrg(db, req, ["owner", "admin"]);
    const body = z.object({ email, role: z.enum(["admin", "member"]).default("member") }).parse(req.body);
    const [already] = await db
      .select({ id: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, ctx.orgId), eq(users.email, body.email)));
    if (already) throw new HttpError(409, "Этот пользователь уже в команде");
    const token = randomBytes(24).toString("base64url");
    const [inv] = await db
      .insert(invitations)
      .values({ orgId: ctx.orgId, email: body.email, role: body.role, token, invitedBy: ctx.userId })
      .onConflictDoUpdate({ target: [invitations.orgId, invitations.email], set: { role: body.role, token } })
      .returning();
    return { id: inv!.id, email: inv!.email, role: inv!.role, link: inviteLink(inv!.token) };
  });

  app.delete<{ Params: { id: string } }>("/api/orgs/current/invitations/:id", async (req) => {
    const ctx = await requireOrg(db, req, ["owner", "admin"]);
    await db
      .delete(invitations)
      .where(and(eq(invitations.id, Number(req.params.id)), eq(invitations.orgId, ctx.orgId)));
    return { ok: true };
  });

  app.patch<{ Params: { userId: string } }>("/api/orgs/current/members/:userId", async (req) => {
    const ctx = await requireOrg(db, req, ["owner"]);
    const body = z.object({ role: z.enum(["admin", "member"]) }).parse(req.body);
    const target = Number(req.params.userId);
    if (target === ctx.userId) throw new HttpError(400, "Нельзя изменить собственную роль");
    await db
      .update(memberships)
      .set({ role: body.role })
      .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, target)));
    return { ok: true };
  });

  app.delete<{ Params: { userId: string } }>("/api/orgs/current/members/:userId", async (req) => {
    const target = Number(req.params.userId);
    const ctx = await requireOrg(db, req);
    const [m] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, target)));
    if (!m) throw new HttpError(404, "Сотрудник не найден");
    if (m.role === "owner") throw new HttpError(400, "Владельца нельзя удалить из организации");
    const isSelf = target === ctx.userId;
    if (!isSelf && ctx.role === "member") throw new HttpError(403, "Недостаточно прав");
    if (!isSelf && ctx.role === "admin" && m.role === "admin") throw new HttpError(403, "Администратора может удалить только владелец");
    await db.delete(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, target)));
    return { ok: true };
  });

  app.get<{ Params: { token: string } }>("/api/invitations/:token", async (req) => {
    const [inv] = await db
      .select({ email: invitations.email, orgName: organizations.name })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.orgId))
      .where(eq(invitations.token, req.params.token));
    if (!inv) throw new HttpError(404, "Приглашение не найдено или уже использовано");
    return inv;
  });

  app.post<{ Params: { token: string } }>("/api/invitations/:token/accept", async (req, reply) => {
    const s = await requireUser(req);
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, s.uid));
    const inv = await findInvitation(db, req.params.token, user?.email ?? "");
    await acceptInvitation(db, inv, s.uid);
    await setSession(app, reply, { uid: s.uid, oid: inv.orgId });
    return { ok: true };
  });
}
