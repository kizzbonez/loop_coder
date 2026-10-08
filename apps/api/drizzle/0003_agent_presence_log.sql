CREATE TABLE `agent_presence_log` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`agent_name` text NOT NULL,
	`user_name` text,
	`at` integer NOT NULL,
	`task_id` text,
	`task_key` text,
	`role_key` text,
	`ceremony` text,
	`activity` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agent_presence_log_project_idx` ON `agent_presence_log` (`project_id`,`at`);--> statement-breakpoint
CREATE INDEX `agent_presence_log_session_idx` ON `agent_presence_log` (`session_id`,`at`);