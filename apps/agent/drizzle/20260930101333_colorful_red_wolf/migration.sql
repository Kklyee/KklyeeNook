ALTER TABLE `agent_runs` ADD `workspace_id` text REFERENCES workspaces(id);--> statement-breakpoint
ALTER TABLE `artifacts` ADD `workspace_id` text REFERENCES workspaces(id);
--> statement-breakpoint
INSERT INTO workspaces (id, display_name, last_known_path, status, created_at, updated_at)
SELECT 'legacy-memory-' || lower(hex(randomblob(16))), workspace_path, workspace_path, 'detached', min(created_at), max(updated_at)
FROM memories WHERE scope = 'workspace' AND workspace_id IS NULL AND workspace_path IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM workspaces WHERE last_known_path = memories.workspace_path OR root_path = memories.workspace_path)
GROUP BY workspace_path;
--> statement-breakpoint
UPDATE memories SET workspace_id = (SELECT id FROM workspaces WHERE last_known_path = memories.workspace_path OR root_path = memories.workspace_path LIMIT 1)
WHERE scope = 'workspace' AND workspace_id IS NULL AND workspace_path IS NOT NULL;
--> statement-breakpoint
INSERT INTO workspaces (id, display_name, last_known_path, status, created_at, updated_at)
SELECT 'legacy-knowledge-' || id, name, path, 'detached', 0, 0 FROM knowledge_sources
WHERE kind = 'workspace' AND workspace_id IS NULL
AND NOT EXISTS (SELECT 1 FROM workspaces WHERE last_known_path = knowledge_sources.path OR root_path = knowledge_sources.path);
--> statement-breakpoint
UPDATE knowledge_sources SET workspace_id = (SELECT id FROM workspaces WHERE last_known_path = knowledge_sources.path OR root_path = knowledge_sources.path LIMIT 1), workspace_relative_path = ''
WHERE kind = 'workspace' AND workspace_id IS NULL;
--> statement-breakpoint
UPDATE agent_runs SET workspace_id = (SELECT workspace_id FROM conversations WHERE conversations.id = agent_runs.session_id) WHERE workspace_id IS NULL;
--> statement-breakpoint
UPDATE artifacts SET workspace_id = (SELECT workspace_id FROM agent_runs WHERE agent_runs.id = artifacts.run_id) WHERE workspace_id IS NULL;
