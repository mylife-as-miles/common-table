PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_test_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`attempt` integer NOT NULL,
	`reservation_cents` integer DEFAULT 5 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`scope`) REFERENCES `ai_test_budget`(`scope`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_test_attempt_fixed_reservation" CHECK("__new_ai_test_attempts"."attempt">=1 AND "__new_ai_test_attempts"."attempt"<=100 AND "__new_ai_test_attempts"."reservation_cents"=5)
);
--> statement-breakpoint
INSERT INTO `__new_ai_test_attempts`("id", "scope", "attempt", "reservation_cents", "created_at") SELECT "id", "scope", "attempt", "reservation_cents", "created_at" FROM `ai_test_attempts`;--> statement-breakpoint
DROP TABLE `ai_test_attempts`;--> statement-breakpoint
ALTER TABLE `__new_ai_test_attempts` RENAME TO `ai_test_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_test_attempt_scope` ON `ai_test_attempts` (`scope`,`attempt`);--> statement-breakpoint
CREATE TABLE `__new_ai_test_budget` (
	`scope` text PRIMARY KEY NOT NULL,
	`cap_cents` integer DEFAULT 500 NOT NULL,
	`reserved_cents` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ai_test_budget_fixed_cap" CHECK("__new_ai_test_budget"."cap_cents"=500 AND "__new_ai_test_budget"."attempts">=0 AND "__new_ai_test_budget"."attempts"<=100 AND "__new_ai_test_budget"."reserved_cents"="__new_ai_test_budget"."attempts"*5 AND "__new_ai_test_budget"."reserved_cents"<="__new_ai_test_budget"."cap_cents")
);
--> statement-breakpoint
INSERT INTO `__new_ai_test_budget`("scope", "cap_cents", "reserved_cents", "attempts", "updated_at") SELECT "scope", "cap_cents", "reserved_cents", "attempts", "updated_at" FROM `ai_test_budget`;--> statement-breakpoint
DROP TABLE `ai_test_budget`;--> statement-breakpoint
ALTER TABLE `__new_ai_test_budget` RENAME TO `ai_test_budget`;