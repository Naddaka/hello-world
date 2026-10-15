CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`prompt` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`provider_job_id` text,
	`result_path` text,
	`cost_estimate` real,
	`error` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_created_at_idx` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_model_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`price_unit` text NOT NULL,
	`price_usd` real NOT NULL,
	`price_rules` text,
	`params_schema` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL
);
