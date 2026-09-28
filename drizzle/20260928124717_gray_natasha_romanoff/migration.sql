CREATE TABLE `scheduled_tasks` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`schedule` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`session_id` text,
	`skill_ids` text DEFAULT '[]' NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_scheduled_tasks_session_id_conversations_id_fk` FOREIGN KEY (`session_id`) REFERENCES `conversations`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `scheduled_task_id` text;--> statement-breakpoint
CREATE INDEX `agent_runs_scheduled_task_idx` ON `agent_runs` (`scheduled_task_id`);--> statement-breakpoint
CREATE INDEX `scheduled_tasks_enabled_next_run_idx` ON `scheduled_tasks` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `scheduled_tasks_session_idx` ON `scheduled_tasks` (`session_id`);