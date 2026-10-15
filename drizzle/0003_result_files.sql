ALTER TABLE `jobs` ADD `result_urls` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `result_files` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `download_attempts` integer DEFAULT 0 NOT NULL;