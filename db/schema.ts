import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, primaryKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";

export const sharedTables = sqliteTable("shared_tables", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  revision: integer("revision").notNull().default(1),
  version: integer("version").notNull().default(1),
  planJson: text("plan_json").notNull(),
  lastOperation: text("last_operation"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [check("shared_table_versions", sql`${t.revision} >= 1 AND ${t.version} >= ${t.revision}`)]);

export const sharedMembers = sqliteTable("shared_members", {
  tableId: text("table_id").notNull().references(() => sharedTables.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["owner", "member"] }).notNull(),
  preferencesJson: text("preferences_json").notNull(),
  approvedRevision: integer("approved_revision"),
  joinedAt: integer("joined_at").notNull(),
}, (t) => [primaryKey({ columns: [t.tableId, t.userId] }), index("shared_members_user").on(t.userId), check("shared_member_role", sql`${t.role} IN ('owner','member')`)]);

export const sharedInvites = sqliteTable("shared_invites", {
  id: text("id").primaryKey(),
  tableId: text("table_id").notNull().references(() => sharedTables.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  acceptedBy: text("accepted_by"),
  acceptedAt: integer("accepted_at"),
  revokedAt: integer("revoked_at"),
}, (t) => [uniqueIndex("shared_invites_token").on(t.tokenHash), index("shared_invites_table").on(t.tableId)]);

export const sharedOperations = sqliteTable("shared_operations", {
  actorId: text("actor_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  responseJson: text("response_json").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.actorId, t.idempotencyKey] })]);

/** One fixed global test scope; runtime reservation adapter may never refill it. */
export const aiTestBudget = sqliteTable("ai_test_budget", {
  scope: text("scope").primaryKey(),
  capCents: integer("cap_cents").notNull().default(500),
  reservedCents: integer("reserved_cents").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [check("ai_test_budget_fixed_cap", sql`${t.capCents}=500 AND ${t.attempts}>=0 AND ${t.attempts}<=100 AND ${t.reservedCents}=${t.attempts}*5 AND ${t.reservedCents}<=${t.capCents}`)]);

export const aiTestAttempts = sqliteTable("ai_test_attempts", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull().references(() => aiTestBudget.scope),
  attempt: integer("attempt").notNull(),
  reservationCents: integer("reservation_cents").notNull().default(5),
  createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("ai_test_attempt_scope").on(t.scope, t.attempt), check("ai_test_attempt_fixed_reservation", sql`${t.attempt}>=1 AND ${t.attempt}<=100 AND ${t.reservationCents}=5`)]);

export const serviceQuotas = sqliteTable("service_quotas", {
  scope: text("scope").notNull(),
  windowStart: text("window_start").notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.scope, t.windowStart] }), check("service_quota_nonnegative", sql`${t.count}>=0`)]);

export const aiBudgetInitialization = sqliteTable("ai_budget_initialization", {
  scope: text("scope").primaryKey(),
  operationId: text("operation_id").notNull(),
  initializedAt: integer("initialized_at").notNull(),
}, (t) => [check("ai_budget_initialization_scope", sql`${t.scope}='global-test-v1'`)]);
