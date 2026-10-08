ALTER TABLE `api_tokens` ADD `role_keys` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `git_mode` text DEFAULT 'worktrees' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `base_branch` text DEFAULT 'main' NOT NULL;--> statement-breakpoint
-- Projects created before worktrees keep working in the shared folder until an owner switches them.
UPDATE `projects` SET `git_mode` = 'shared';
