import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DbHandle } from "../src/db/index.js";
import { openTestDb } from "./db.js";
import { buildApp } from "../src/http/app.js";
import { runIngest } from "../src/ingest/run.js";
import { MockSource } from "../src/ingest/mock.js";

let handle: DbHandle;
let app: FastifyInstance;

beforeAll(async () => {
  handle = await openTestDb();
  app = await buildApp(handle.db);
  await runIngest(handle.db, new MockSource(120), () => {});
});

afterAll(async () => {
  await app.close();
  await handle.close();
});

class Client {
  cookie = "";
  async req(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: object) {
    const res = await app.inject({ method, url, payload, headers: this.cookie ? { cookie: this.cookie } : {} });
    const set = res.headers["set-cookie"];
    const first = Array.isArray(set) ? set[0] : set;
    if (first) this.cookie = first.split(";")[0]!;
    return { status: res.statusCode, body: res.json() };
  }
}

describe("api", () => {
  const owner = new Client();
  const employee = new Client();
  const stranger = new Client();
  let ownerOrgId: number;

  it("registers an owner with own organization", async () => {
    const r = await owner.req("POST", "/api/auth/register", {
      email: "Boss@Example.com",
      password: "password123",
      name: "Босс",
      orgName: "ООО Ромашка",
    });
    expect(r.status).toBe(200);
    const me = await owner.req("GET", "/api/me");
    expect(me.body.user.email).toBe("boss@example.com");
    expect(me.body.org).toMatchObject({ name: "ООО Ромашка", role: "owner" });
    ownerOrgId = me.body.org.id;
  });

  it("rejects duplicate registration and wrong password", async () => {
    const dup = await new Client().req("POST", "/api/auth/register", {
      email: "boss@example.com",
      password: "password123",
      name: "X",
    });
    expect(dup.status).toBe(409);
    const bad = await new Client().req("POST", "/api/auth/login", { email: "boss@example.com", password: "nope" });
    expect(bad.status).toBe(401);
  });

  it("invited employee joins the employer workspace through the link", async () => {
    const inv = await owner.req("POST", "/api/orgs/current/invitations", { email: "worker@example.com" });
    expect(inv.status).toBe(200);
    expect(inv.body.link).toContain("/register?invite=");
    const inviteToken = new URL(inv.body.link).searchParams.get("invite");

    const info = await new Client().req("GET", `/api/invitations/${inviteToken}`);
    expect(info.body).toEqual({ email: "worker@example.com", orgName: "ООО Ромашка" });

    const reg = await employee.req("POST", "/api/auth/register", {
      email: "worker@example.com",
      password: "password123",
      name: "Сотрудник",
      inviteToken,
    });
    expect(reg.status).toBe(200);
    const me = await employee.req("GET", "/api/me");
    expect(me.body.orgs).toHaveLength(1);
    expect(me.body.org).toMatchObject({ id: ownerOrgId, role: "member" });
    const members = await owner.req("GET", "/api/orgs/current/members");
    expect(members.body.members).toHaveLength(2);
    expect(members.body.invitations).toHaveLength(0);
  });

  it("knowing an invited email is not enough to join", async () => {
    await owner.req("POST", "/api/orgs/current/invitations", { email: "accountant@example.com" });
    const intruder = new Client();
    await intruder.req("POST", "/api/auth/register", { email: "accountant@example.com", password: "password123", name: "Чужой" });
    const me = await intruder.req("GET", "/api/me");
    expect(me.body.orgs.map((o: { id: number }) => o.id)).not.toContain(ownerOrgId);
  });

  it("rejects an invitation link used with another email", async () => {
    const inv = await owner.req("POST", "/api/orgs/current/invitations", { email: "lawyer@example.com" });
    const inviteToken = new URL(inv.body.link).searchParams.get("invite");
    const r = await new Client().req("POST", "/api/auth/register", {
      email: "someone@example.com",
      password: "password123",
      name: "X",
      inviteToken,
    });
    expect(r.status).toBe(403);
    const login = await new Client().req("POST", "/api/auth/login", { email: "someone@example.com", password: "password123" });
    expect(login.status).toBe(401);
  });

  it("uninvited user gets a separate workspace and cannot see others' data", async () => {
    await stranger.req("POST", "/api/auth/register", { email: "other@example.com", password: "password123", name: "Чужой" });
    const me = await stranger.req("GET", "/api/me");
    expect(me.body.org.id).not.toBe(ownerOrgId);
    const sw = await stranger.req("POST", "/api/orgs/switch", { orgId: ownerOrgId });
    expect(sw.status).toBe(403);
  });

  it("existing user accepts an invitation and keeps their own workspace", async () => {
    const consultant = new Client();
    await consultant.req("POST", "/api/auth/register", { email: "consultant@example.com", password: "password123", name: "Консультант" });
    const inv = await owner.req("POST", "/api/orgs/current/invitations", { email: "consultant@example.com", role: "admin" });
    const inviteToken = new URL(inv.body.link).searchParams.get("invite");

    expect((await stranger.req("POST", `/api/invitations/${inviteToken}/accept`)).status).toBe(403);
    expect((await consultant.req("POST", `/api/invitations/${inviteToken}/accept`)).status).toBe(200);

    const me = await consultant.req("GET", "/api/me");
    expect(me.body.orgs).toHaveLength(2);
    expect(me.body.org).toMatchObject({ id: ownerOrgId, role: "admin" });
    expect((await consultant.req("POST", `/api/invitations/${inviteToken}/accept`)).status).toBe(404);
  });

  it("members cannot change keys", async () => {
    const r = await employee.req("POST", "/api/keys", { type: "okpd2", value: "26.20" });
    expect(r.status).toBe(403);
  });

  it("validates key formats", async () => {
    expect((await owner.req("POST", "/api/keys", { type: "okpd2", value: "abc" })).status).toBe(400);
    expect((await owner.req("POST", "/api/keys", { type: "region", value: "00" })).status).toBe(400);
  });

  it("filters the shared registry by organization keys", async () => {
    const empty = await owner.req("GET", "/api/tenders");
    expect(empty.body.noKeys).toBe(true);

    expect((await owner.req("POST", "/api/keys", { type: "okpd2", value: "26.20" })).status).toBe(200);
    const r = await owner.req("GET", "/api/tenders?pageSize=100");
    expect(r.body.total).toBeGreaterThan(0);
    for (const t of r.body.items) expect(t.title).toMatch(/компьютерн|ноутбук|монитор/i);

    await owner.req("POST", "/api/keys", { type: "region", value: "77" });
    const r2 = await owner.req("GET", "/api/tenders?pageSize=100");
    expect(r2.body.total).toBeLessThanOrEqual(r.body.total);
    for (const t of r2.body.items) expect(t.regionCode).toBe("77");

    const all = await owner.req("GET", "/api/tenders?scope=all&activeOnly=false&pageSize=1");
    expect(all.body.total).toBe(120);

    const strangerView = await stranger.req("GET", "/api/tenders");
    expect(strangerView.body.noKeys).toBe(true);
  });

  it("keeps per-organization tender state private", async () => {
    const list = await owner.req("GET", "/api/tenders?scope=all&pageSize=1");
    const id = list.body.items[0].id;
    const me = await employee.req("GET", "/api/me");
    const put = await owner.req("PUT", `/api/tenders/${id}/state`, {
      favorite: true,
      status: "applying",
      note: "Готовим заявку",
      assigneeId: me.body.user.id,
    });
    expect(put.status).toBe(200);

    const seenByEmployee = await employee.req("GET", `/api/tenders/${id}`);
    expect(seenByEmployee.body.state).toMatchObject({ favorite: true, status: "applying", note: "Готовим заявку" });

    const seenByStranger = await stranger.req("GET", `/api/tenders/${id}`);
    expect(seenByStranger.body.state).toMatchObject({ favorite: false, status: "new", note: null });

    const strangerAssign = await stranger.req("PUT", `/api/tenders/${id}/state`, { assigneeId: me.body.user.id });
    expect(strangerAssign.status).toBe(400);

    const favs = await owner.req("GET", "/api/tenders?scope=all&favorite=true");
    expect(favs.body.items.map((t: { id: number }) => t.id)).toEqual([id]);
  });

  it("removed employee loses access immediately", async () => {
    const me = await employee.req("GET", "/api/me");
    const del = await owner.req("DELETE", `/api/orgs/current/members/${me.body.user.id}`);
    expect(del.status).toBe(200);
    const r = await employee.req("GET", "/api/tenders");
    expect(r.status).toBe(403);
  });

  it("re-ingest does not duplicate tenders", async () => {
    await runIngest(handle.db, new MockSource(120), () => {});
    const all = await owner.req("GET", "/api/tenders?scope=all&activeOnly=false&pageSize=1");
    expect(all.body.total).toBe(120);
  });
});
