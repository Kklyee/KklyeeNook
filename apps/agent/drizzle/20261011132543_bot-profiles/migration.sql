CREATE TABLE `bots` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`kind` text NOT NULL,
	`instructions` text NOT NULL,
	`is_built_in` integer NOT NULL,
	`model` text,
	`thinking_level` text,
	`enabled_tools` text NOT NULL,
	`workspace_ids` text NOT NULL,
	`default_workspace_id` text,
	`permission_mode` text NOT NULL,
	`avatar` text NOT NULL,
	`main_thread_id` text NOT NULL UNIQUE,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
ALTER TABLE `conversations` ADD `bot_id` text REFERENCES bots(id);