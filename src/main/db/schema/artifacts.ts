import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { ArtifactKind, ArtifactMetadata } from '@/shared/artifact/artifact'
import { agentRuns } from './agentRuns'
import { conversations } from './conversations'

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    toolCallId: text('tool_call_id'),
    kind: text('kind').$type<ArtifactKind>().notNull(),
    title: text('title').notNull(),
    targetPath: text('target_path'),
    metadata: text('metadata', { mode: 'json' }).$type<ArtifactMetadata>().notNull().default({}),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('artifacts_session_created_at_idx').on(table.sessionId, table.createdAt),
    index('artifacts_run_created_at_idx').on(table.runId, table.createdAt),
    index('artifacts_tool_call_idx').on(table.toolCallId),
  ],
)

export type ArtifactRow = typeof artifacts.$inferSelect
