import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { BotMessage, BotTask } from '@kklyeenook/shared/bot/grove'
import type { NetworkBotIdentity, RelayEnvelope } from '@kklyeenook/shared/bot/social'
import type { SocialOutboxEntry } from '../../grove/remote-transport'

export const botMessages = sqliteTable('bot_messages', {
  id: text('id').primaryKey(),
  fromBotId: text('from_bot_id').notNull(),
  toBotId: text('to_bot_id').notNull(),
  type: text('type').$type<BotMessage['type']>().notNull(),
  content: text('content').notNull(),
  correlationId: text('correlation_id'),
  createdAt: integer('created_at').notNull(),
  remote: text('remote').$type<BotMessage['remote']>(),
})

export const botTasks = sqliteTable('bot_tasks', {
  id: text('id').primaryKey(),
  fromBotId: text('from_bot_id').notNull(),
  toBotId: text('to_bot_id').notNull(),
  instruction: text('instruction').notNull(),
  status: text('status').$type<BotTask['status']>().notNull(),
  result: text('result'),
  sourceThreadId: text('source_thread_id').notNull(),
  targetThreadId: text('target_thread_id'),
  submissionId: integer('submission_id'),
  chainId: text('chain_id').notNull(),
  parentTaskId: text('parent_task_id'),
  depth: integer('depth').notNull(),
  deadline: integer('deadline').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  remote: text('remote', { mode: 'json' }).$type<BotTask['remote']>(),
})

export const networkIdentity = sqliteTable('network_identity', {
  localBotId: text('local_bot_id').primaryKey(),
  identity: text('identity', { mode: 'json' }).$type<NetworkBotIdentity>().notNull(),
})

export const remoteContacts = sqliteTable('remote_contacts', {
  networkId: text('network_id').primaryKey(),
  identity: text('identity', { mode: 'json' }).$type<NetworkBotIdentity>().notNull(),
})

export const socialInbox = sqliteTable('social_inbox', {
  id: text('id').primaryKey(),
  envelope: text('envelope', { mode: 'json' }).$type<RelayEnvelope>().notNull(),
  processedAt: integer('processed_at'),
  error: text('error'),
})

export const socialOutbox = sqliteTable('social_outbox', {
  id: text('id').primaryKey(),
  entry: text('entry', { mode: 'json' }).$type<SocialOutboxEntry>().notNull(),
})
