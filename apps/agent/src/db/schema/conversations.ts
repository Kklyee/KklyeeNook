import type { PermissionMode } from '@kklyeenook/shared/approval/permission'
import { workspaces } from './workspaces'
import { bots } from './bots'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    botId: text('bot_id').references(() => bots.id),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    permissionMode: text('permission_mode').$type<PermissionMode>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [index('conversations_updated_at_idx').on(table.updatedAt)],
)
export type ConversationRow = typeof conversations.$inferSelect

export type NewConversationRow = typeof conversations.$inferInsert
