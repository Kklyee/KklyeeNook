import { expect, test } from 'vitest'
import type { AgentEvent, InputDelivery } from '@/shared/agent/agentEvent'
import type { AgentExecutionRecord } from '@/shared/agent/agentExecutionRecord'
import { ExecutionBoundaryTracker } from './executionBoundaryTracker'
import { ExecutionSequencer } from './executionSequencer'
import { ExecutionTraceProjector } from './executionTraceProjector'

function harness(runId = 'run-1') {
  const records: AgentExecutionRecord[] = []
  const sequencer = new ExecutionSequencer()
  const boundary = new ExecutionBoundaryTracker(emit)
  function emit(event: AgentEvent) {
    const seq = sequencer.next(runId)
    records.push({
      id: seq,
      seq,
      sessionId: 'session-1',
      runId,
      timestamp: seq,
      ...(event.type === 'user_message' ? {} : boundary.correlation),
      event,
    })
  }
  function input(inputId: string, delivery: InputDelivery = 'initial') {
    boundary.enqueue({ inputId, delivery })
    emit({ type: 'user_message', inputId, delivery, text: inputId })
  }
  function trace(status: 'completed' | 'interrupted' = 'completed') {
    return new ExecutionTraceProjector().project({ id: runId, status }, records)
  }
  input('initial')
  return { boundary, input, emit, records, trace }
}

function assertBrackets(records: readonly AgentExecutionRecord[]) {
  let stepId: string | undefined
  let previousSeq = 0
  const sequences = new Set<number>()
  const starts = new Set<string>()
  const ends = new Set<string>()
  records.forEach((record) => {
    expect(record.seq).toBeGreaterThan(previousSeq)
    expect(sequences.has(record.seq)).toBe(false)
    sequences.add(record.seq)
    previousSeq = record.seq
    const event = record.event
    if (event.type === 'step_started') {
      expect(stepId).toBeUndefined()
      expect(starts.has(event.stepId)).toBe(false)
      starts.add(event.stepId)
      stepId = event.stepId
    }
    if (event.type === 'step_ended') {
      expect(event.stepId).toBe(stepId)
      expect(ends.has(event.stepId)).toBe(false)
      ends.add(event.stepId)
      stepId = undefined
    }
  })
  expect(stepId).toBeUndefined()
  expect(ends).toEqual(starts)
}

test.each([1, 3])('projects one Run with %i inference Steps', (count) => {
  const h = harness()
  for (let index = 0; index < count; index++) {
    h.boundary.onPiTurnStart(index, index === 0 ? ['initial'] : [])
    if (index < count - 1) {
      h.emit({ type: 'tool_started', call: { id: `tool-${index}`, toolName: 'read', args: {} } })
      h.emit({
        type: 'tool_finished',
        result: { toolCallId: `tool-${index}`, toolName: 'read', status: 'success', content: [{ type: 'text', text: 'ok' }] },
      })
    } else h.emit({ type: 'text_delta', text: 'done' })
    h.boundary.onPiTurnEnd('committed')
  }
  expect(h.boundary.canSettleRun()).toBe(true)
  expect(h.trace().steps).toHaveLength(count)
  expect(h.trace().steps.map((step) => step.ordinal)).toEqual(
    Array.from({ length: count }, (_, index) => index + 1),
  )
  expect(h.trace().steps.map((step) => step.acceptedInputIds)).toEqual(
    Array.from({ length: count }, (_, index) => index === 0 ? ['initial'] : []),
  )
  assertBrackets(h.records)
})

test('three tools belong to one Step', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  for (let index = 0; index < 3; index++) {
    h.emit({ type: 'tool_started', call: { id: `tool-${index}`, toolName: 'read', args: {} } })
    h.emit({
      type: 'tool_finished',
      result: { toolCallId: `tool-${index}`, toolName: 'read', status: 'success', content: [{ type: 'text', text: 'ok' }] },
    })
  }
  h.boundary.onPiTurnEnd('committed')
  expect(h.trace().steps).toHaveLength(1)
  expect(
    h.trace().steps[0]?.events.filter((record) => record.event.type === 'tool_started'),
  ).toHaveLength(3)
  assertBrackets(h.records)
})

test('claims multiple steering inputs together after the running Step finishes', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  h.input('a', 'steer')
  h.input('b', 'steer')
  h.input('c', 'steer')
  expect(h.trace().steps).toHaveLength(1)
  expect(h.trace().steps[0]?.acceptedInputIds).toEqual(['initial'])
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onPiTurnStart(1, ['steer', 'steer', 'steer'])
  h.boundary.onPiTurnEnd('committed')
  expect(h.trace().steps.map((step) => step.acceptedInputIds)).toEqual([
    ['initial'], ['a', 'b', 'c'],
  ])
  expect(h.trace().steps[1]?.ordinal).toBe(2)
  assertBrackets(h.records)
})

test('only claims inputs actually delivered by Pi, including inputs arriving near a boundary', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  h.input('a', 'steer')
  h.boundary.onPiTurnEnd('committed')
  h.input('late', 'steer')
  h.boundary.onPiTurnStart(1, ['steer'])
  expect(h.trace().steps[1]?.acceptedInputIds).toEqual(['a'])
  expect(h.boundary.hasPendingInputs).toBe(true)
  h.boundary.onPiTurnEnd('committed')
  expect(h.boundary.canSettleRun()).toBe(false)
  h.boundary.onPiTurnStart(2, ['steer'])
  h.boundary.onPiTurnEnd('committed')
  expect(h.boundary.canSettleRun()).toBe(true)
  expect(h.trace().steps[2]?.acceptedInputIds).toEqual(['late'])
  assertBrackets(h.records)
})

test('follow-up waits through continuing Steps in the same Run', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  h.input('follow', 'follow-up')
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onPiTurnStart(1, [])
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onPiTurnStart(2, ['follow-up'])
  h.boundary.onPiTurnEnd('committed')
  expect(h.trace().steps.map((step) => step.acceptedInputIds)).toEqual([
    ['initial'], [], ['follow'],
  ])
  expect(new Set(h.records.map((record) => record.runId))).toEqual(new Set(['run-1']))
  assertBrackets(h.records)
})

test.each(['aborted', 'failed'] as const)(
  'closes active brackets before the %s terminal event',
  (reason) => {
    const h = harness()
    h.boundary.onPiTurnStart(0, ['initial'])
    h.boundary.terminate()
    h.emit(
      reason === 'failed' ? { type: 'agent_failed', error: 'failure' } : { type: 'agent_aborted' },
    )
    h.boundary.terminate()
    expect(h.records.slice(-2).map((record) => record.event.type)).toEqual([
      'step_ended',
      `agent_${reason}`,
    ])
    expect(h.trace().steps[0]?.result).toBe('aborted')
    assertBrackets(h.records)
  },
)

test('retains the same Run across runtime retry cycles and only counts Pi turn boundaries', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  h.boundary.onPiTurnEnd('aborted')
  h.emit({ type: 'agent_started' })
  expect(h.trace().steps).toHaveLength(1)
  h.boundary.onPiTurnStart(1, [])
  h.boundary.onPiTurnEnd('committed')
  expect(h.trace().steps).toHaveLength(2)
  expect(h.trace().steps.map((step) => step.result)).toEqual(['aborted', 'committed'])
  expect(new Set(h.records.map((record) => record.runId))).toEqual(new Set(['run-1']))
  assertBrackets(h.records)
})

test('interrupts only open brackets without repairing historical events', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onPiTurnStart(1, [])
  const before = structuredClone(h.records)
  const trace = h.trace('interrupted')
  expect(trace.steps[0]?.interrupted).toBeUndefined()
  expect(trace.steps[1]).toMatchObject({ interrupted: true })
  expect(trace.steps[1]?.endedSeq).toBeUndefined()
  expect(h.records).toEqual(before)
})

test('leaves old events flat without inferring boundaries', () => {
  const h = harness()
  h.emit({ type: 'text_delta', text: 'legacy' })
  h.emit({ type: 'tool_started', call: { id: 'legacy-tool', toolName: 'read', args: {} } })
  expect(h.trace().steps).toEqual([])
  expect(h.trace().unscopedEvents).toEqual(h.records)
})

test('rejects overlapping Steps and ignores duplicate Step ends', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  expect(() => h.boundary.onPiTurnStart(1, [])).toThrow('A Step is already active')
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onPiTurnEnd('committed')
  expect(h.boundary.canSettleRun()).toBe(true)
  assertBrackets(h.records)
})

test('restores durable sequencing independently for parent and child runs', () => {
  const sequencer = new ExecutionSequencer()
  sequencer.restore('parent', 50)
  expect(sequencer.next('parent')).toBe(51)
  expect(sequencer.next('child')).toBe(1)
  expect(sequencer.next('parent')).toBe(52)
  expect(sequencer.next('child')).toBe(2)
})

test('projects increasing sequences with gaps and unordered storage rows', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  h.emit({ type: 'text_delta', text: 'done' })
  h.boundary.onPiTurnEnd('committed')
  for (const record of h.records) record.seq *= 3
  assertBrackets(h.records)
  const trace = new ExecutionTraceProjector().project({ id: 'run-1', status: 'completed' }, [...h.records].reverse())
  expect(trace.steps).toMatchObject([{ startedSeq: 6, endedSeq: 12, acceptedInputIds: ['initial'], result: 'committed' }])
  expect(trace.steps[0]?.events.map((record) => record.seq)).toEqual([6, 9, 12])
})

test('leaves unaccepted inputs unscoped when a Run terminates', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  h.input('pending', 'steer')
  h.boundary.terminate()
  const trace = h.trace()
  expect(trace.steps[0]?.acceptedInputIds).toEqual(['initial'])
  expect(trace.unscopedEvents).toMatchObject([{ event: { type: 'user_message', inputId: 'pending' } }])
  expect(h.boundary.hasPendingInputs).toBe(false)
  assertBrackets(h.records)
})

test('terminates before any Step without synthesizing a boundary', () => {
  const h = harness()
  h.boundary.terminate()
  h.emit({ type: 'agent_aborted' })
  expect(h.trace().steps).toEqual([])
  expect(h.records.map((record) => record.event.type)).toEqual(['user_message', 'agent_aborted'])
  expect(h.trace().unscopedEvents).toEqual(h.records)
})

test('claims delivery kinds independently and rolls back an invalid claim', () => {
  const h = harness()
  h.input('follow', 'follow-up')
  h.input('steer', 'steer')
  expect(() => h.boundary.onPiTurnStart(0, ['initial', 'steer', 'steer'])).toThrow('No pending steer input')
  expect(h.trace().steps).toEqual([])
  h.boundary.onPiTurnStart(0, ['initial', 'steer'])
  h.boundary.onPiTurnEnd('committed')
  expect(h.boundary.canSettleRun()).toBe(false)
  h.boundary.onPiTurnStart(1, ['follow-up'])
  h.boundary.onPiTurnEnd('committed')
  expect(h.trace().steps.map((step) => step.acceptedInputIds)).toEqual([['initial', 'steer'], ['follow']])
  assertBrackets(h.records)
})
