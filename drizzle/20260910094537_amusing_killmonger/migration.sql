CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`error` text,
	CONSTRAINT `fk_agent_runs_session_id_conversations_id_fk` FOREIGN KEY (`session_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `agent_runs_session_created_at_idx` ON `agent_runs` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_runs_status_idx` ON `agent_runs` (`status`);