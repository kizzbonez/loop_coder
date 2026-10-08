CREATE TABLE `api_agent_usage` (
	`agent_id` text NOT NULL,
	`day` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`agent_id`, `day`),
	FOREIGN KEY (`agent_id`) REFERENCES `api_agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `api_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`provider_id` text,
	`model` text DEFAULT '' NOT NULL,
	`role_keys` text,
	`daily_token_limit` integer NOT NULL,
	`max_turns_per_step` integer NOT NULL,
	`can_run_commands` integer DEFAULT true NOT NULL,
	`state` text DEFAULT 'stopped' NOT NULL,
	`token_id` text,
	`token_sealed` text,
	`token_key_id` text,
	`status_activity` text,
	`status_error` text,
	`status_at` integer,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `ai_providers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`token_id`) REFERENCES `api_tokens`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_agents_project_name_uq` ON `api_agents` (`project_id`,`name`);