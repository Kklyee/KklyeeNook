CREATE TABLE `permission_grants` (
	`id` text PRIMARY KEY,
	`effect` text NOT NULL,
	`duration` text NOT NULL,
	`session_id` text,
	`tool_name` text NOT NULL,
	`action` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource` text NOT NULL,
	`recursive` integer NOT NULL,
	`description` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_permission_grants_session_id_conversations_id_fk` FOREIGN KEY (`session_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `permission_grants_match_idx` ON `permission_grants` (`tool_name`,`action`);