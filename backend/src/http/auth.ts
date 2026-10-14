import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { config } from "../config.js";
import type { DB } from "../db/index.js";
import { memberships, type Role } from "../db/schema.js";

export const SESSION_COOKIE = "tg_session";
const MAX_AGE = 30 * 24 * 3600;

export interface SessionPayload {
  uid: number;
  oid: number | null;
}

export interface AuthContext {
  userId: number;
  orgId: number;
  role: Role;
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export async function setSession(app: FastifyInstance, reply: FastifyReply, payload: SessionPayload) {
  const token = app.jwt.sign(payload, { expiresIn: MAX_AGE });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.COOKIE_SECURE,
    // Scoped to the site's path so other applications on the same domain never receive the session.
    path: config.BASE_PATH,
    maxAge: MAX_AGE,
  });
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: config.BASE_PATH });
}

export async function readSession(req: FastifyRequest): Promise<SessionPayload | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  try {
    return req.server.jwt.verify<SessionPayload>(token);
  } catch {
    return null;
  }
}

export async function requireUser(req: FastifyRequest): Promise<SessionPayload> {
  const s = await readSession(req);
  if (!s) throw new HttpError(401, "Требуется вход");
  return s;
}

/** Re-checks membership on every request so removed employees lose access immediately. */
export async function requireOrg(db: DB, req: FastifyRequest, roles?: Role[]): Promise<AuthContext> {
  const s = await requireUser(req);
  if (!s.oid) throw new HttpError(403, "Нет активной организации");
  const [m] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, s.uid), eq(memberships.orgId, s.oid)));
  if (!m) throw new HttpError(403, "Нет доступа к организации");
  if (roles && !roles.includes(m.role)) throw new HttpError(403, "Недостаточно прав");
  return { userId: s.uid, orgId: s.oid, role: m.role };
}
