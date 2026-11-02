CREATE TABLE `ai_budget_initialization` (
	`scope` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`initialized_at` integer NOT NULL,
	CONSTRAINT "ai_budget_initialization_scope" CHECK("ai_budget_initialization"."scope"='global-test-v1')
);
