ALTER TABLE `agent_runs` ADD `tool_calls` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `tool_results` text DEFAULT '[]' NOT NULL;