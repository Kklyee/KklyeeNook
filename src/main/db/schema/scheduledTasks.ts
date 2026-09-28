import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { ScheduledTaskSchedule } from '@/shared/scheduler/scheduledTask'
import { conversations } from './conversations'

export const scheduledTasks = sqliteTable(
  'scheduled_tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    prompt: text('prompt').notNull(),
    schedule: text('schedule', { mode: 'json' }).$type<ScheduledTaskSchedule>().notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    sessionId: text('session_id').references(() => conversations.id, { onDelete: 'set null' }),
    skillIds: text('skill_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    lastRunAt: integer('last_run_at'),
    nextRunAt: integer('next_run_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('scheduled_tasks_enabled_next_run_idx').on(table.enabled, table.nextRunAt),
    index('scheduled_tasks_session_idx').on(table.sessionId),
  ],
)

export type ScheduledTaskRow = typeof scheduledTasks.$inferSelect
