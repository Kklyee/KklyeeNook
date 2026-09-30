CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY,
	`display_name` text NOT NULL,
	`root_path` text,
	`last_known_path` text,
	`status` text NOT NULL,
	`fs_device` text,
	`fs_inode` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_opened_at` integer
);
