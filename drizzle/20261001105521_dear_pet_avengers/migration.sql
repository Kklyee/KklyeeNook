CREATE TABLE `__new_agent_execution_records` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `session_id` text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  `run_id` text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  `seq` integer NOT NULL,
  `turn_id` text,
  `step_id` text,
  `timestamp` integer NOT NULL,
  `event_type` text NOT NULL,
  `event_json` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_agent_execution_records` (id, session_id, run_id, seq, timestamp, event_type, event_json)
SELECT id, session_id, run_id, row_number() OVER (PARTITION BY run_id ORDER BY timestamp, id), timestamp, event_type, event_json
FROM agent_execution_records;--> statement-breakpoint
DROP TABLE `agent_execution_records`;--> statement-breakpoint
ALTER TABLE `__new_agent_execution_records` RENAME TO `agent_execution_records`;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_execution_records_run_seq_idx` ON `agent_execution_records` (`run_id`,`seq`);--> statement-breakpoint
CREATE INDEX `agent_execution_records_run_turn_seq_idx` ON `agent_execution_records` (`run_id`,`turn_id`,`seq`);--> statement-breakpoint
CREATE INDEX `agent_execution_records_run_step_seq_idx` ON `agent_execution_records` (`run_id`,`step_id`,`seq`);--> statement-breakpoint
CREATE INDEX `agent_execution_records_session_idx` ON `agent_execution_records` (`session_id`);
