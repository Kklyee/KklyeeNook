import type { BotAvatarConfig, BotProfile } from '@kklyeenook/shared/bot/bot'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const bots = sqliteTable('bots', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  kind: text('kind').$type<BotProfile['kind']>().notNull(),
  instructions: text('instructions').notNull(),
  isBuiltIn: integer('is_built_in', { mode: 'boolean' }).notNull(),
  model: text('model', { mode: 'json' }).$type<BotProfile['model']>(),
  thinkingLevel: text('thinking_level').$type<BotProfile['thinkingLevel']>(),
  enabledTools: text('enabled_tools', { mode: 'json' }).$type<string[]>().notNull(),
  workspaceIds: text('workspace_ids', { mode: 'json' }).$type<string[]>().notNull(),
  defaultWorkspaceId: text('default_workspace_id'),
  permissionMode: text('permission_mode').$type<BotProfile['permissionMode']>().notNull(),
  avatar: text('avatar', { mode: 'json' }).$type<BotAvatarConfig>().notNull(),
  mainThreadId: text('main_thread_id').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
})
