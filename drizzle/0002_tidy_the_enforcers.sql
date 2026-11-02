CREATE TABLE `service_quotas` (
	`scope` text NOT NULL,
	`window_start` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`scope`, `window_start`),
	CONSTRAINT "service_quota_nonnegative" CHECK("service_quotas"."count">=0)
);
