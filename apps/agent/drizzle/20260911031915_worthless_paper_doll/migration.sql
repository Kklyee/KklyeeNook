CREATE TABLE `agent_execution_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`session_id` text NOT NULL,
	`run_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`event_type` text NOT NULL,
	`event_json` text NOT NULL,
	CONSTRAINT `fk_agent_execution_records_session_id_conversations_id_fk` FOREIGN KEY (`session_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_agent_execution_records_run_id_agent_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `agent_execution_records_run_timestamp_idx` ON `agent_execution_records` (`run_id`,`timestamp`,`id`);--> statement-breakpoint
CREATE INDEX `agent_execution_records_session_idx` ON `agent_execution_records` (`session_id`);