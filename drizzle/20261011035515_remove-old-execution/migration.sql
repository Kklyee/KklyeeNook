DROP INDEX IF EXISTS `agent_messages_session_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `agent_runs_session_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `agent_runs_parent_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `agent_runs_root_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `agent_runs_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `agent_runs_scheduled_task_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `agent_execution_records_run_seq_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `agent_execution_records_run_step_seq_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `agent_execution_records_session_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `artifacts_session_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `artifacts_run_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `artifacts_tool_call_idx`;--> statement-breakpoint
DROP TABLE `agent_messages`;--> statement-breakpoint
DROP TABLE `agent_runtime_states`;--> statement-breakpoint
DROP TABLE `agent_runs`;--> statement-breakpoint
DROP TABLE `agent_execution_records`;--> statement-breakpoint
DROP TABLE `artifacts`;