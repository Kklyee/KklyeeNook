import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('conversations_updated_at_idx').on(table.updatedAt)],
)
export const agentMessages = sqliteTable(
  'agent_messages',
  {
    id: text('id').notNull(),
    sessionId: text('session_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    createdAt: integer('created_at').notNull(),
    payloadJson: text('payload_json').notNull(),

    runConfigJson: text('run_config_json'),
  },

  (table) => [
    primaryKey({ columns: [table.sessionId, table.id] }),
    index('agent_messages_session_idx').on(table.sessionId, table.createdAt),
  ],
)
export type ConversationRow = typeof conversations.$inferSelect

export type NewConversationRow = typeof conversations.$inferInsert
