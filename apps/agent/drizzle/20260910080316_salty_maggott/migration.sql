CREATE TABLE `agent_messages` (
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`parent_id` text,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`payload_json` text NOT NULL,
	`run_config_json` text,
	CONSTRAINT `agent_messages_pk` PRIMARY KEY(`session_id`, `id`),
	CONSTRAINT `fk_agent_messages_session_id_conversations_id_fk` FOREIGN KEY (`session_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `agent_messages_session_idx` ON `agent_messages` (`session_id`,`created_at`);