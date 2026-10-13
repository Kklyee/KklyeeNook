import type { Context } from '@earendil-works/chord'
import { LiveDoc, type ConversationId, type SnapshotEvent, type SubmissionId } from '@earendil-works/pi-durable'
import type { AgentHost } from './agent-host'
import { runMembershipDoc } from './run-membership'

export function sliceRunHistory(snapshot: SnapshotEvent, starts: readonly number[], before?: number) {
  const boundaries = [...new Set(starts)].sort((a, b) => a - b)
  const candidates = boundaries.filter((id) => before === undefined || id < before)
  const selected = candidates.slice(-2)
  const sinceEntry = selected[0] ?? before ?? snapshot.entries[0]?.id
  return {
    entries: snapshot.entries.filter((entry) => (sinceEntry === undefined || entry.id >= sinceEntry) && (before === undefined || entry.id < before)),
    sinceEntry,
    hasMore: candidates.length > selected.length,
  }
}

export async function runStarts(host: AgentHost, id: ConversationId, context: Context, before?: number) {
  const membership = await host.engine.harness.snapshot(runMembershipDoc, id, context)
  const live = await host.engine.harness.snapshot(LiveDoc, id, context)
  const inputs = [...new Set([
    ...(live?.run?.inputs.slice(0, 1) ?? []),
    ...Object.entries(membership?.tasks ?? {}).sort(([a], [b]) => Number(b) - Number(a)).map(([, input]) => input),
  ])]
  const starts: number[] = []
  for (const input of inputs) {
    const submission = await host.engine.harness.submission(input as SubmissionId, context)
    const entry = (await submission?.status(context))?.entry
    if (entry !== undefined && (before === undefined || entry < before)) starts.push(entry)
    if (starts.length === 3) break
  }
  return starts
}

export async function threadHistory(host: AgentHost, threadId: string, snapshot: SnapshotEvent, context: Context, before?: number) {
  const conversation = await host.engine.conversation(threadId, context)
  return sliceRunHistory(snapshot, await runStarts(host, conversation.id, context, before), before)
}
