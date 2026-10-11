CREATE TABLE `memories` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`workspace_path` text,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memories_scope_workspace_idx` ON `memories` (`scope`,`workspace_path`);--> statement-breakpoint
CREATE INDEX `memories_updated_at_idx` ON `memories` (`updated_at`);