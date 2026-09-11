import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type {
  PermissionGrantDuration,
  PermissionResourceKind,
} from '@/shared/approval/approvalTypes'
import { conversations } from './conversations'

export const permissionGrants = sqliteTable(
  'permission_grants',
  {
    id: text('id').primaryKey(),
    effect: text('effect', { enum: ['allow'] }).notNull(),
    duration: text('duration').$type<PermissionGrantDuration>().notNull(),
    sessionId: text('session_id').references(() => conversations.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    action: text('action').notNull(),
    resourceKind: text('resource_kind').$type<PermissionResourceKind>().notNull(),
    resource: text('resource').notNull(),
    recursive: integer('recursive', { mode: 'boolean' }).notNull(),
    description: text('description').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('permission_grants_match_idx').on(table.toolName, table.action)],
)

export type PermissionGrantRow = typeof permissionGrants.$inferSelect
