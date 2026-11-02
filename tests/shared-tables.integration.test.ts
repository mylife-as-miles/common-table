import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createSharedD1 } from "./helpers/shared-d1.ts";
import type { ServiceContext } from "../server/services.ts";
import { venues } from "../src/domain/data.ts";

// Only this server-owned fixture supplies identity. Request headers never become identity.
const originalFetch = globalThis.fetch;
let externalCalls = 0;
globalThis.fetch = async () => {
  externalCalls++;
  throw new Error(
    "No provider calls are allowed in shared-table integration tests.",
  );
};
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(externalCalls, 0);
});
const { handleServices } = await import("../server/services.ts");
const origin = "https://synthetic-tables.example";
const host = {
  userId: "synthetic-host",
  displayName: "Synthetic Host",
  email: "host@example.invalid",
};
const member = {
  userId: "synthetic-member",
  displayName: "Synthetic Member",
  email: "member@example.invalid",
};
const outsider = {
  userId: "synthetic-outsider",
  displayName: "Synthetic Outsider",
  email: "outsider@example.invalid",
};
type Identity = ServiceContext["identity"];
const preferences = {
  tastes: ["Italian"],
  budget: 80,
  restrictions: ["Vegetarian"],
};
const plan = {
  venueId: "juniper",
  venueSnapshot: venues[0],
  date: "2099-04-12",
  time: "19:30",
  note: "Synthetic group dinner.",
  saved: false,
};

function fixture(t: TestContext) {
  const d1 = createSharedD1();
  t.after(d1.close);
  const call = async (
    path: string,
    identity: Identity,
    body?: unknown,
    options: { key?: string; headers?: Record<string, string> } = {},
  ) => {
    const headers =
      body === undefined
        ? { ...options.headers }
        : {
            Origin: origin,
            "Content-Type": "application/json",
            "X-Common-Table-Request": "shared-table",
            "Idempotency-Key": options.key ?? crypto.randomUUID(),
            ...options.headers,
          };
    const response = await handleServices(
      new Request(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { db: d1.db, identity },
    );
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? JSON.parse(text) : null,
    };
  };
  const create = async () => {
    const result = await call("/api/shared-tables", host, {
      title: "Synthetic protocol supper",
      preferences,
      plan,
    });
    assert.equal(result.status, 200);
    return result.body.table;
  };
  const invite = async (table: { id: string; version: number }) => {
    const token = randomBytes(32).toString("base64url");
    const result = await call(`/api/shared-tables/${table.id}/invites`, host, {
      version: table.version,
      token,
    });
    assert.equal(result.status, 200);
    return { table: result.body.table, token };
  };
  const pair = async () => {
    const invitation = await invite(await create());
    const joined = await call("/api/shared-tables/join", member, {
      token: invitation.token,
      preferences,
    });
    assert.equal(joined.status, 200);
    return joined.body.table;
  };
  return { ...d1, call, create, invite, pair };
}

test("the deployed service facade ignores forged identity headers and isolates host and member authority", async (t) => {
  const f = fixture(t);
  const forged = {
    "oai-authenticated-user-id": host.userId,
    "oai-authenticated-user-email": host.email,
    "X-User-Id": host.userId,
    Authorization: "Bearer synthetic-not-an-identity",
  };
  const session = await f.call("/api/shared-tables/session", null, undefined, {
    headers: forged,
  });
  assert.equal(session.status, 200);
  assert.deepEqual(session.body, { identity: null, available: true });
  assert.equal(
    (
      await f.call(
        "/api/shared-tables",
        null,
        { title: "Forged", preferences, plan },
        { headers: forged },
      )
    ).status,
    401,
  );
  assert.equal(
    f.sqlite.prepare("SELECT count(*) AS count FROM shared_tables").get()
      ?.count,
    0,
  );
  let table = await f.pair();
  assert.equal(
    (
      await f.call(
        `/api/shared-tables/${table.id}/plan`,
        member,
        {
          version: table.version,
          plan: { ...plan, note: "Forged host change" },
        },
        { headers: forged },
      )
    ).status,
    403,
  );
  const updated = await f.call(
    `/api/shared-tables/${table.id}/preferences`,
    member,
    { version: table.version, preferences: { ...preferences, budget: 60 } },
    { headers: forged },
  );
  assert.equal(updated.status, 200);
  table = updated.body.table;
  assert.equal(
    table.members.find(
      (value: { userId: string }) => value.userId === member.userId,
    ).preferences.budget,
    60,
  );
  assert.equal(
    table.members.find(
      (value: { userId: string }) => value.userId === host.userId,
    ).preferences.budget,
    80,
  );
  assert.equal(
    (
      await f.call(`/api/shared-tables/${table.id}/preferences`, member, {
        version: table.version,
        userId: host.userId,
        preferences,
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.call(`/api/shared-tables/${table.id}`, outsider)).status,
    404,
  );
  const visible = await f.call(`/api/shared-tables/${table.id}`, member);
  assert.equal(visible.body.table.viewerId, member.userId);
  assert.equal(visible.body.table.invites, undefined);
  assert.equal(visible.body.table.plan.note, plan.note);
});

test("a replayed save cannot resurrect stale approval after another authenticated member edits preferences", async (t) => {
  const f = fixture(t);
  let table = await f.pair();
  table = (
    await f.call(`/api/shared-tables/${table.id}/approval`, host, {
      version: table.version,
      approved: true,
    })
  ).body.table;
  assert.equal(
    (
      await f.call(`/api/shared-tables/${table.id}/save`, host, {
        version: table.version,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call(`/api/shared-tables/${table.id}/approval`, host, {
        version: table.version,
        approved: true,
        userId: member.userId,
      })
    ).status,
    400,
  );
  table = (
    await f.call(`/api/shared-tables/${table.id}/approval`, member, {
      version: table.version,
      approved: true,
    })
  ).body.table;
  const saveBody = { version: table.version },
    key = crypto.randomUUID(),
    revision = table.revision;
  const saved = await f.call(
    `/api/shared-tables/${table.id}/save`,
    host,
    saveBody,
    { key },
  );
  assert.equal(saved.status, 200);
  table = saved.body.table;
  assert.equal(table.plan.saved, true);
  assert.equal(table.revision, revision);
  table = (
    await f.call(`/api/shared-tables/${table.id}/preferences`, member, {
      version: table.version,
      preferences: { ...preferences, budget: 55 },
    })
  ).body.table;
  assert.equal(table.plan.saved, false);
  assert.equal(table.revision, revision + 1);
  assert.ok(
    table.members.every(
      (value: { approvedRevision: number | null }) =>
        value.approvedRevision !== table.revision,
    ),
  );
  const replay = await f.call(
    `/api/shared-tables/${table.id}/save`,
    host,
    saveBody,
    { key },
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.table.plan.saved, false);
  assert.equal(replay.body.table.version, table.version);
  const changedPayload = await f.call(
    `/api/shared-tables/${table.id}/save`,
    host,
    { version: table.version },
    { key },
  );
  assert.equal(changedPayload.status, 409);
  assert.equal(changedPayload.body.code, "idempotency_conflict");
  assert.equal(
    (
      await f.call(`/api/shared-tables/${table.id}/save`, host, {
        version: table.version,
      })
    ).status,
    409,
  );
});

test("two authenticated edits to one version have one winner and explicit conflict recovery preserves both intents", async (t) => {
  const f = fixture(t);
  let table = await f.pair();
  const version = table.version;
  const responses = await Promise.all([
    f.call(`/api/shared-tables/${table.id}/plan`, host, {
      version,
      plan: { ...plan, note: "The host's concurrent edit." },
    }),
    f.call(`/api/shared-tables/${table.id}/preferences`, member, {
      version,
      preferences: { ...preferences, budget: 55 },
    }),
  ]);
  assert.deepEqual(responses.map((value) => value.status).sort(), [200, 409]);
  table = (await f.call(`/api/shared-tables/${table.id}`, host)).body.table;
  assert.equal(table.version, version + 1);
  const retry =
    responses[0].status === 409
      ? await f.call(`/api/shared-tables/${table.id}/plan`, host, {
          version: table.version,
          plan: { ...plan, note: "The host's concurrent edit." },
        })
      : await f.call(`/api/shared-tables/${table.id}/preferences`, member, {
          version: table.version,
          preferences: { ...preferences, budget: 55 },
        });
  assert.equal(retry.status, 200);
  table = retry.body.table;
  assert.equal(table.plan.note, "The host's concurrent edit.");
  assert.equal(
    table.members.find(
      (value: { userId: string }) => value.userId === member.userId,
    ).preferences.budget,
    55,
  );
  assert.equal(table.version, version + 2);
  assert.equal(table.plan.saved, false);
});

test("one invitation has one concurrent accepter and removed membership cannot bypass an ETag check", async (t) => {
  const f = fixture(t);
  const invitation = await f.invite(await f.create());
  const joins = await Promise.all([
    f.call("/api/shared-tables/join", member, {
      token: invitation.token,
      preferences,
    }),
    f.call("/api/shared-tables/join", outsider, {
      token: invitation.token,
      preferences,
    }),
  ]);
  assert.equal(joins.filter((value) => value.status === 200).length, 1);
  assert.ok(
    joins
      .filter((value) => value.status !== 200)
      .every((value) => [409, 410].includes(value.status)),
  );
  const winner = joins[0].status === 200 ? member : outsider;
  const before = await f.call(
    `/api/shared-tables/${invitation.table.id}`,
    winner,
  );
  assert.equal(before.status, 200);
  assert.equal(before.body.table.members.length, 2);
  const removed = await f.call(
    `/api/shared-tables/${invitation.table.id}/remove-member`,
    host,
    { version: before.body.table.version, userId: winner.userId },
  );
  assert.equal(removed.status, 200);
  const cached = await f.call(
    `/api/shared-tables/${invitation.table.id}`,
    winner,
    undefined,
    { headers: { "If-None-Match": before.headers.get("etag")! } },
  );
  assert.equal(cached.status, 404);
  assert.equal(cached.body.table, undefined);
  assert.equal(
    (
      await f.call(
        `/api/shared-tables/${invitation.table.id}/approval`,
        winner,
        { version: removed.body.table.version, approved: true },
      )
    ).status,
    404,
  );
  assert.equal(
    f.sqlite
      .prepare("SELECT count(*) AS count FROM shared_members WHERE table_id=?")
      .get(invitation.table.id)?.count,
    1,
  );
});
