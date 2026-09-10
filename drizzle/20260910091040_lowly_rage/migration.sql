CREATE TABLE `agent_runtime_states` (
	`session_id` text PRIMARY KEY,
	`runtime_kind` text NOT NULL,
	`resume_ref` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_agent_runtime_states_session_id_conversations_id_fk` FOREIGN KEY (`session_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE
);
