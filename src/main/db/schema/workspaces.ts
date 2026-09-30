import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { Workspace } from '@/shared/workspace/workspace'

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  rootPath: text('root_path'),
  lastKnownPath: text('last_known_path'),
  status: text('status').$type<Workspace['status']>().notNull(),
  fsDevice: text('fs_device'),
  fsInode: text('fs_inode'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastOpenedAt: integer('last_opened_at'),
})
