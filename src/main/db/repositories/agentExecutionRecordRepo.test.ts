import { readFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/libsql'
import { expect, test } from 'vitest'
import { DrizzleAgentExecutionRecordRepo } from './agentExecutionRecordRepo'
import type { Database } from '../client'
import { ExecutionTraceProjector } from '@/shared/agent/executionTraceProjector'

async function applyMigration(db: Database, folder: string) {
  const sql = readFileSync(new URL(`../../../../drizzle/${folder}/migration.sql`, import.meta.url), 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) await db.$client.execute(statement)
}

test('migrates legacy ordering without inventing boundaries and enforces durable run sequences', async () => {
  const db = drizzle('file::memory:')
  try {
    await db.$client.executeMultiple(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE conversations (id TEXT PRIMARY KEY);
      CREATE TABLE agent_runs (id TEXT PRIMARY KEY);
      CREATE TABLE agent_execution_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
        run_id TEXT NOT NULL, timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL, event_json TEXT NOT NULL
      );
      INSERT INTO conversations VALUES ('session-1');
      INSERT INTO agent_runs VALUES ('run-1'), ('run-2');
      INSERT INTO agent_execution_records VALUES
        (10, 'session-1', 'run-1', 200, 'text_delta', '{"type":"text_delta","text":"later"}'),
        (20, 'session-1', 'run-1', 100, 'text_delta', '{"type":"text_delta","text":"first"}'),
        (30, 'session-1', 'run-1', 100, 'text_delta', '{"type":"text_delta","text":"second"}'),
        (40, 'session-1', 'run-2', 100, 'text_delta', '{"type":"text_delta","text":"other run"}');
    `)
    await applyMigration(db, '20261001105521_dear_pet_avengers')
    await applyMigration(db, '20261001123347_execution_steps')
    const repo = new DrizzleAgentExecutionRecordRepo(db)
    const legacy = await repo.findByRunId('run-1')
    expect(legacy.map((record) => [record.id, record.seq, record.stepId])).toEqual([
      [20, 1, undefined],
      [30, 2, undefined],
      [10, 3, undefined],
    ])
    expect(await repo.getMaxSeq('run-1')).toBe(3)
    expect(await repo.getMaxSeq('missing')).toBe(0)
    const envelope = {
      sessionId: 'session-1',
      runId: 'run-1',
      seq: 10,
      stepId: 'step-1',
      timestamp: 50,
      event: { type: 'text_delta' as const, text: 'durable' },
    }
    await repo.append(envelope)
    await expect(repo.append(envelope)).rejects.toThrow()
    await repo.append({ ...envelope, runId: 'run-2', seq: 2 })
    expect((await repo.findByRunId('run-1')).at(-1)).toMatchObject(envelope)
    expect(await repo.getMaxSeq('run-1')).toBe(10)
    await db.$client.execute("DELETE FROM agent_runs WHERE id = 'run-1'")
    expect(await repo.findByRunId('run-1')).toEqual([])
    expect(await repo.findByRunId('run-2')).toHaveLength(2)
  } finally {
    db.$client.close()
  }
})

test('converts saved boundaries into Run-local Steps without changing ids or sequences', async () => {
  const db = drizzle('file::memory:')
  try {
    await db.$client.executeMultiple(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE conversations (id TEXT PRIMARY KEY);
      CREATE TABLE agent_runs (id TEXT PRIMARY KEY);
      CREATE TABLE agent_execution_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
        run_id TEXT NOT NULL, timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL, event_json TEXT NOT NULL
      );
      INSERT INTO conversations VALUES ('session-1');
      INSERT INTO agent_runs VALUES ('run-1'), ('run-2');
    `)
    await applyMigration(db, '20261001105521_dear_pet_avengers')
    async function insert(runId: string, seq: number, event: Record<string, unknown>, turnId?: string, stepId?: string) {
      await db.$client.execute({
        sql: 'INSERT INTO agent_execution_records (id, session_id, run_id, seq, turn_id, step_id, timestamp, event_type, event_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [seq + (runId === 'run-2' ? 100 : 0), 'session-1', runId, seq, turnId ?? null, stepId ?? null, 1000 - seq, String(event.type), JSON.stringify(event)],
      })
    }
    const events: [number, Record<string, unknown>, string?, string?][] = [
      [1, { type: 'user_message', inputId: 'a', delivery: 'initial', text: 'initial' }],
      [2, { type: 'user_message', inputId: 'b', delivery: 'steer', text: 'startup steer' }],
      [3, { type: 'turn_started', turnId: 't1', ordinal: 1, inputIds: ['a', 'b'] }, 't1'],
      [4, { type: 'step_started', turnId: 't1', stepId: 's1', ordinal: 1, piTurnIndex: 0 }, 't1', 's1'],
      [5, { type: 'tool_started', call: { id: 'tool-1', toolName: 'read', args: { turnId: 'tool-argument' } } }, 't1', 's1'],
      [6, { type: 'tool_finished', result: { toolCallId: 'tool-1', toolName: 'read', success: true, output: 'ok' } }, 't1', 's1'],
      [7, { type: 'step_ended', turnId: 't1', stepId: 's1', result: 'committed' }, 't1', 's1'],
      [8, { type: 'context_compaction_started', reason: 'threshold' }, 't1'],
      [9, { type: 'step_started', turnId: 't1', stepId: 's2', ordinal: 2, piTurnIndex: 1 }, 't1', 's2'],
      [10, { type: 'text_delta', text: 'before steering' }, 't1', 's2'],
      [11, { type: 'step_ended', turnId: 't1', stepId: 's2', result: 'committed' }, 't1', 's2'],
      [12, { type: 'user_message', inputId: 'c', delivery: 'follow-up', text: 'follow up' }],
      [13, { type: 'turn_ended', turnId: 't1', reason: 'completed' }, 't1'],
      [14, { type: 'turn_started', turnId: 't2', ordinal: 2, inputIds: ['c'] }, 't2'],
      [15, { type: 'step_started', turnId: 't2', stepId: 's3', ordinal: 1, piTurnIndex: 2 }, 't2', 's3'],
      [16, { type: 'user_message', inputId: 'pending', delivery: 'steer', text: 'unprocessed' }],
      [17, { type: 'step_ended', turnId: 't2', stepId: 's3', result: 'aborted' }, 't2', 's3'],
      [18, { type: 'turn_ended', turnId: 't2', reason: 'aborted' }, 't2'],
      [19, { type: 'agent_aborted' }],
    ]
    for (const [seq, event, turnId, stepId] of [...events].reverse()) await insert('run-1', seq, event, turnId, stepId)
    await insert('run-2', 1, { type: 'user_message', inputId: 'child', delivery: 'initial', text: 'child task' })
    await insert('run-2', 2, { type: 'turn_started', turnId: 't1', ordinal: 1, inputIds: ['child'] }, 't1')
    await insert('run-2', 4, { type: 'step_started', turnId: 't1', stepId: 'child-step', ordinal: 1, piTurnIndex: 0 }, 't1', 'child-step')
    await applyMigration(db, '20261001123347_execution_steps')

    const repo = new DrizzleAgentExecutionRecordRepo(db)
    const records = await repo.findByRunId('run-1')
    const retained = events.filter(([, event]) => event.type !== 'turn_started' && event.type !== 'turn_ended')
    expect(records.map((record) => [record.id, record.seq, record.timestamp])).toEqual(retained.map(([seq]) => [seq, seq, 1000 - seq]))
    for (const record of records) {
      expect(record).not.toHaveProperty('turnId')
      expect(record.event).not.toHaveProperty('turnId')
    }
    const trace = new ExecutionTraceProjector().project({ id: 'run-1', status: 'aborted' }, records)
    expect(trace.steps.map((step) => [step.ordinal, step.piTurnIndex, step.acceptedInputIds])).toEqual([
      [1, 0, ['a', 'b']], [2, 1, []], [3, 2, ['c']],
    ])
    expect(trace.steps.map((step) => step.result)).toEqual(['committed', 'committed', 'aborted'])
    expect(trace.unscopedEvents.filter((record) => record.event.type === 'user_message')).toMatchObject([
      { seq: 16, event: { inputId: 'pending' } },
    ])
    expect(records.find((record) => record.event.type === 'tool_started')?.event).toMatchObject({ call: { args: { turnId: 'tool-argument' } } })
    expect(trace.unscopedEvents.some((record) => record.event.type === 'context_compaction_started')).toBe(true)
    const child = new ExecutionTraceProjector().project({ id: 'run-2', status: 'interrupted' }, await repo.findByRunId('run-2'))
    expect(child.steps).toMatchObject([{ ordinal: 1, acceptedInputIds: ['child'], interrupted: true }])
    expect(await repo.getMaxSeq('run-1')).toBe(19)
    const columns = await db.$client.execute('PRAGMA table_info(agent_execution_records)')
    expect(columns.rows.map((row) => row.name)).not.toContain('turn_id')
    const indexes = await db.$client.execute('PRAGMA index_list(agent_execution_records)')
    expect(indexes.rows.map((row) => row.name)).toEqual(expect.arrayContaining([
      'agent_execution_records_run_seq_idx', 'agent_execution_records_run_step_seq_idx', 'agent_execution_records_session_idx',
    ]))
    expect(indexes.rows.map((row) => row.name)).not.toContain('agent_execution_records_run_turn_seq_idx')
  } finally {
    db.$client.close()
  }
})
