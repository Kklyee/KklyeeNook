ALTER TABLE `knowledge_sources` ADD `workspace_id` text REFERENCES workspaces(id);--> statement-breakpoint
DROP INDEX IF EXISTS `knowledge_source_path_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_source_workspace_path_idx` ON `knowledge_sources` (`workspace_id`,`path`);