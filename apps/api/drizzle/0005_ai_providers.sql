CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`preset` text NOT NULL,
	`kind` text NOT NULL,
	`base_url` text NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`api_key_sealed` text NOT NULL,
	`api_key_id` text NOT NULL,
	`api_key_hint` text,
	`last_test_at` integer,
	`last_test_ok` integer,
	`last_test_message` text,
	`models` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_providers_name_uq` ON `ai_providers` (`name`);