CREATE TABLE `network_identity` (
	`local_bot_id` text PRIMARY KEY,
	`identity` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `remote_contacts` (
	`network_id` text PRIMARY KEY,
	`identity` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `social_inbox` (
	`id` text PRIMARY KEY,
	`envelope` text NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE TABLE `social_outbox` (
	`id` text PRIMARY KEY,
	`entry` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `bot_tasks` ADD `remote` text;