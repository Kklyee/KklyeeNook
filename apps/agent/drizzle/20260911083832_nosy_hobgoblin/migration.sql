CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`run_id` text NOT NULL,
	`tool_call_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`target_path` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_artifacts_session_id_conversations_id_fk` FOREIGN KEY (`session_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_artifacts_run_id_agent_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `artifact_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `artifacts_session_created_at_idx` ON `artifacts` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `artifacts_run_created_at_idx` ON `artifacts` (`run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `artifacts_tool_call_idx` ON `artifacts` (`tool_call_id`);