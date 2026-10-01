import { readFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/libsql'
import { expect, test } from 'vitest'
import { DrizzleAgentExecutionRecordRepo } from './agentExecutionRecordRepo'

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
    const sql = readFileSync(
      new URL(
        '../../../../drizzle/20261001105521_dear_pet_avengers/migration.sql',
        import.meta.url,
      ),
      'utf8',
    )
    for (const statement of sql.split('--> statement-breakpoint'))
      await db.$client.execute(statement)
    const repo = new DrizzleAgentExecutionRecordRepo(db)
    const legacy = await repo.findByRunId('run-1')
    expect(legacy.map((record) => [record.id, record.seq, record.turnId, record.stepId])).toEqual([
      [20, 1, undefined, undefined],
      [30, 2, undefined, undefined],
      [10, 3, undefined, undefined],
    ])
    expect(await repo.getMaxSeq('run-1')).toBe(3)
    expect(await repo.getMaxSeq('missing')).toBe(0)
    const envelope = {
      sessionId: 'session-1',
      runId: 'run-1',
      seq: 4,
      turnId: 'turn-1',
      stepId: 'step-1',
      timestamp: 50,
      event: { type: 'text_delta' as const, text: 'durable' },
    }
    await repo.append(envelope)
    await expect(repo.append(envelope)).rejects.toThrow()
    await repo.append({ ...envelope, runId: 'run-2', seq: 2 })
    expect((await repo.findByRunId('run-1')).at(-1)).toMatchObject(envelope)
    expect(await repo.getMaxSeq('run-1')).toBe(4)
    await db.$client.execute("DELETE FROM agent_runs WHERE id = 'run-1'")
    expect(await repo.findByRunId('run-1')).toEqual([])
    expect(await repo.findByRunId('run-2')).toHaveLength(2)
  } finally {
    db.$client.close()
  }
})
