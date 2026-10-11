ALTER TABLE `agent_runs` ADD `parent_run_id` text REFERENCES agent_runs(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `root_run_id` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `depth` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `result` text;--> statement-breakpoint
CREATE INDEX `agent_runs_parent_idx` ON `agent_runs` (`parent_run_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_root_idx` ON `agent_runs` (`root_run_id`);