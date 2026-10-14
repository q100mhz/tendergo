import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  // Empty DATABASE_URL = embedded PGlite in PGLITE_DIR (local development only)
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default("./.data/pglite"),
  JWT_SECRET: z.string().min(16).default("dev-secret-change-me-please"),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  // URL path the site lives under (https://itb2bhost.ru/tendergo); must match the frontend build.
  BASE_PATH: z
    .string()
    .default("/tendergo")
    .transform((v) => `/${v.replace(/^\/+|\/+$/g, "")}`)
    .refine((v) => /^(\/[A-Za-z0-9._~-]+)+$/.test(v), "BASE_PATH must look like /tendergo"),
  // Public address of the site including BASE_PATH; used in invitation links.
  PUBLIC_URL: z.string().optional(),
  TENDER_SOURCE: z.enum(["eis", "mock"]).default("eis"),
  INGEST_CRON: z.string().default("5 * * * *"),
  INGEST_ON_START: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  EIS_BASE_URL: z.string().default("https://zakupki.gov.ru"),
  EIS_DELAY_MS: z.coerce.number().default(1500),
  EIS_MAX_PAGES: z.coerce.number().default(40),
  RETENTION_DAYS: z.coerce.number().default(30),
});

const parsed = schema.parse(process.env);

if (parsed.NODE_ENV === "production" && parsed.JWT_SECRET === "dev-secret-change-me-please") {
  throw new Error("JWT_SECRET must be set in production");
}

export const config = {
  ...parsed,
  PUBLIC_URL: (parsed.PUBLIC_URL ?? `http://localhost:5173${parsed.BASE_PATH}`).replace(/\/+$/, ""),
  COOKIE_SECURE: parsed.COOKIE_SECURE ?? parsed.NODE_ENV === "production",
};
