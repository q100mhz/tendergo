import Fastify from "fastify";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { config } from "../config.js";
import type { DB } from "../db/index.js";
import { HttpError } from "./auth.js";
import { accountRoutes } from "./routes/account.js";
import { tenderRoutes } from "./routes/tenders.js";

export async function buildApp(db: DB, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  await app.register(cookie);
  await app.register(jwt, { secret: config.JWT_SECRET });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: err.issues[0]?.message ?? "Некорректные данные" });
    }
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: "Внутренняя ошибка сервера" });
  });

  app.get("/api/health", async () => ({ ok: true }));
  accountRoutes(app, db);
  tenderRoutes(app, db);
  return app;
}
