import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { AgentMemoryScope } from '@/shared/memory/agentMemory'

export const memories = sqliteTable(
  'memories',
  {
    id: text('id').primaryKey(),
    scope: text('scope', { enum: ['global', 'workspace'] })
      .$type<AgentMemoryScope>()
      .notNull(),
    workspacePath: text('workspace_path'),
    content: text('content').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('memories_scope_workspace_idx').on(table.scope, table.workspacePath),
    index('memories_updated_at_idx').on(table.updatedAt),
  ],
)

export type MemoryRow = typeof memories.$inferSelect
