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
  let turnId: string | undefined
  let stepId: string | undefined
  const starts = new Set<string>()
  const ends = new Set<string>()
  records.forEach((record, index) => {
    expect(record.seq).toBe(index + 1)
    const event = record.event
    if (event.type === 'turn_started') {
      expect(turnId).toBeUndefined()
      expect(starts.has(event.turnId)).toBe(false)
      starts.add(event.turnId)
      turnId = event.turnId
    }
    if (event.type === 'step_started') {
      expect(stepId).toBeUndefined()
      expect(event.turnId).toBe(turnId)
      expect(starts.has(event.stepId)).toBe(false)
      starts.add(event.stepId)
      stepId = event.stepId
    }
    if (event.type === 'step_ended') {
      expect(event.stepId).toBe(stepId)
      expect(event.turnId).toBe(turnId)
      expect(ends.has(event.stepId)).toBe(false)
      ends.add(event.stepId)
      stepId = undefined
    }
    if (event.type === 'turn_ended') {
      expect(stepId).toBeUndefined()
      expect(event.turnId).toBe(turnId)
      expect(ends.has(event.turnId)).toBe(false)
      ends.add(event.turnId)
      turnId = undefined
    }
  })
  expect(stepId).toBeUndefined()
  expect(turnId).toBeUndefined()
  expect(ends).toEqual(starts)
}

test.each([1, 3])('projects one Turn with %i inference Steps', (count) => {
  const h = harness()
  for (let index = 0; index < count; index++) {
    h.boundary.onPiTurnStart(index, index === 0 ? ['initial'] : [])
    if (index < count - 1) {
      h.emit({ type: 'tool_started', call: { id: `tool-${index}`, toolName: 'read', args: {} } })
      h.emit({
        type: 'tool_finished',
        result: { toolCallId: `tool-${index}`, toolName: 'read', success: true, output: 'ok' },
      })
    } else h.emit({ type: 'text_delta', text: 'done' })
    h.boundary.onPiTurnEnd('committed')
  }
  expect(h.boundary.onSettled()).toBe(true)
  expect(h.trace().turns).toHaveLength(1)
  expect(h.trace().turns[0]?.steps.map((step) => step.ordinal)).toEqual(
    Array.from({ length: count }, (_, index) => index + 1),
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
      result: { toolCallId: `tool-${index}`, toolName: 'read', success: true, output: 'ok' },
    })
  }
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onSettled()
  expect(h.trace().turns[0]?.steps).toHaveLength(1)
  expect(
    h.trace().turns[0]?.steps[0]?.events.filter((record) => record.event.type === 'tool_started'),
  ).toHaveLength(3)
  assertBrackets(h.records)
})

test('claims multiple steering inputs together after the running Step finishes', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  h.input('a', 'steer')
  h.input('b', 'steer')
  h.input('c', 'steer')
  expect(h.trace().turns).toHaveLength(1)
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onPiTurnStart(1, ['steer', 'steer', 'steer'])
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onSettled()
  expect(
    h
      .trace()
      .turns.map((turn) => ({
        inputs: turn.inputIds,
        reason: turn.reason,
        steps: turn.steps.length,
      })),
  ).toEqual([
    { inputs: ['initial'], reason: 'next_input', steps: 1 },
    { inputs: ['a', 'b', 'c'], reason: 'completed', steps: 1 },
  ])
  expect(h.trace().turns[1]?.steps[0]?.ordinal).toBe(1)
  assertBrackets(h.records)
})

test('only claims inputs actually delivered by Pi, including inputs arriving near a boundary', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  h.input('a', 'steer')
  h.boundary.onPiTurnEnd('committed')
  h.input('late', 'steer')
  h.boundary.onPiTurnStart(1, ['steer'])
  expect(h.trace().turns[1]?.inputIds).toEqual(['a'])
  expect(h.boundary.hasPendingInputs).toBe(true)
  h.boundary.onPiTurnEnd('committed')
  expect(h.boundary.onSettled()).toBe(false)
  h.boundary.onPiTurnStart(2, ['steer'])
  h.boundary.onPiTurnEnd('committed')
  expect(h.boundary.onSettled()).toBe(true)
  assertBrackets(h.records)
})

test('follow-up waits through continuing Steps and ends the preceding Turn as completed', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  h.input('follow', 'follow-up')
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onPiTurnStart(1, [])
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onPiTurnStart(2, ['follow-up'])
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onSettled()
  expect(h.trace().turns.map((turn) => [turn.inputIds, turn.reason, turn.steps.length])).toEqual([
    [['initial'], 'completed', 2],
    [['follow'], 'completed', 1],
  ])
  assertBrackets(h.records)
})

test.each(['aborted', 'failed'] as const)(
  'closes active brackets before the %s terminal event',
  (reason) => {
    const h = harness()
    h.boundary.onPiTurnStart(0, ['initial'])
    h.boundary.terminate(reason)
    h.emit(
      reason === 'failed' ? { type: 'agent_failed', error: 'failure' } : { type: 'agent_aborted' },
    )
    h.boundary.terminate(reason)
    expect(h.records.slice(-3).map((record) => record.event.type)).toEqual([
      'step_ended',
      'turn_ended',
      `agent_${reason}`,
    ])
    expect(h.trace().turns[0]?.reason).toBe(reason)
    expect(h.trace().turns[0]?.steps[0]?.result).toBe('aborted')
    assertBrackets(h.records)
  },
)

test('retains the same Turn across runtime retry cycles and only counts Pi turn boundaries', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  h.boundary.onPiTurnEnd('aborted')
  h.emit({ type: 'agent_started' })
  expect(h.trace().turns[0]?.steps).toHaveLength(1)
  h.boundary.onPiTurnStart(1, [])
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onSettled()
  expect(h.trace().turns).toHaveLength(1)
  expect(h.trace().turns[0]?.steps).toHaveLength(2)
  assertBrackets(h.records)
})

test('interrupts only open brackets without repairing historical events', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onPiTurnStart(1, [])
  const before = structuredClone(h.records)
  const trace = h.trace('interrupted')
  expect(trace.turns[0]?.reason).toBe('interrupted')
  expect(trace.turns[0]?.endedSeq).toBeUndefined()
  expect(trace.turns[0]?.steps[0]?.interrupted).toBeUndefined()
  expect(trace.turns[0]?.steps[1]).toMatchObject({ interrupted: true })
  expect(trace.turns[0]?.steps[1]?.endedSeq).toBeUndefined()
  expect(h.records).toEqual(before)
})

test('leaves old events flat without inferring boundaries', () => {
  const h = harness()
  h.emit({ type: 'text_delta', text: 'legacy' })
  h.emit({ type: 'tool_started', call: { id: 'legacy-tool', toolName: 'read', args: {} } })
  expect(h.trace().turns).toEqual([])
  expect(h.trace().unscopedEvents).toEqual(h.records)
})

test('rejects overlapping Steps and ignores duplicate Step ends', () => {
  const h = harness()
  h.boundary.onPiTurnStart(0, ['initial'])
  expect(() => h.boundary.onPiTurnStart(1, [])).toThrow('A Step is already active')
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onPiTurnEnd('committed')
  h.boundary.onSettled()
  h.boundary.onSettled()
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
