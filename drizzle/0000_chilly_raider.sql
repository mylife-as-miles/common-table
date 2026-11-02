CREATE TABLE `ai_test_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`attempt` integer NOT NULL,
	`reservation_cents` integer DEFAULT 100 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`scope`) REFERENCES `ai_test_budget`(`scope`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_test_attempt_fixed_reservation" CHECK("ai_test_attempts"."attempt">=1 AND "ai_test_attempts"."attempt"<=5 AND "ai_test_attempts"."reservation_cents"=100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_test_attempt_scope` ON `ai_test_attempts` (`scope`,`attempt`);--> statement-breakpoint
CREATE TABLE `ai_test_budget` (
	`scope` text PRIMARY KEY NOT NULL,
	`cap_cents` integer DEFAULT 500 NOT NULL,
	`reserved_cents` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ai_test_budget_fixed_cap" CHECK("ai_test_budget"."cap_cents"=500 AND "ai_test_budget"."attempts">=0 AND "ai_test_budget"."attempts"<=5 AND "ai_test_budget"."reserved_cents"="ai_test_budget"."attempts"*100 AND "ai_test_budget"."reserved_cents"<="ai_test_budget"."cap_cents")
);
--> statement-breakpoint
CREATE TABLE `shared_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_by` text,
	`accepted_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`table_id`) REFERENCES `shared_tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_invites_token` ON `shared_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `shared_invites_table` ON `shared_invites` (`table_id`);--> statement-breakpoint
CREATE TABLE `shared_members` (
	`table_id` text NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`preferences_json` text NOT NULL,
	`approved_revision` integer,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`table_id`, `user_id`),
	FOREIGN KEY (`table_id`) REFERENCES `shared_tables`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shared_member_role" CHECK("shared_members"."role" IN ('owner','member'))
);
--> statement-breakpoint
CREATE INDEX `shared_members_user` ON `shared_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `shared_operations` (
	`actor_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`actor_id`, `idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `shared_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`plan_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "shared_table_versions" CHECK("shared_tables"."revision" >= 1 AND "shared_tables"."version" >= "shared_tables"."revision")
);
