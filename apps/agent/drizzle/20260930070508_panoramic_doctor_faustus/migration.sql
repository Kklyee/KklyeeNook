CREATE TABLE `knowledge_documents` (
	`id` text PRIMARY KEY,
	`source_id` text NOT NULL,
	`file_path` text NOT NULL,
	`title` text NOT NULL,
	`content_hash` text NOT NULL,
	`embedding_model` text NOT NULL,
	`chunk_count` integer NOT NULL,
	`indexed_at` integer NOT NULL,
	`metadata` text NOT NULL,
	CONSTRAINT `fk_knowledge_documents_source_id_knowledge_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `knowledge_sources`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `knowledge_sources` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`document_count` integer DEFAULT 0 NOT NULL,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`last_indexed` integer,
	`embedding_model` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `knowledge_document_source_idx` ON `knowledge_documents` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_document_path_idx` ON `knowledge_documents` (`source_id`,`file_path`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_source_path_idx` ON `knowledge_sources` (`path`);