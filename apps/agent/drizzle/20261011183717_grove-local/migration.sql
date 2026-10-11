CREATE TABLE `bot_messages` (
	`id` text PRIMARY KEY,
	`from_bot_id` text NOT NULL,
	`to_bot_id` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`correlation_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bot_tasks` (
	`id` text PRIMARY KEY,
	`from_bot_id` text NOT NULL,
	`to_bot_id` text NOT NULL,
	`instruction` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`source_thread_id` text NOT NULL,
	`target_thread_id` text,
	`submission_id` integer,
	`chain_id` text NOT NULL,
	`parent_task_id` text,
	`depth` integer NOT NULL,
	`deadline` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
