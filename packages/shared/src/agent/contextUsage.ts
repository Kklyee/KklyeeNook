import type { Message, SystemMessage } from '@earendil-works/pi-ai'
import { estimateContextTokens, estimateMessageTokens, estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import { getCurrentSystemMessage } from '@earendil-works/pi-ai/utils/transcript'
import type { ContextEdit, SnapshotEvent } from '@earendil-works/pi-durable'

export interface ContextDetails {
  breakdown?: { system: number; tools: number; files: number; toolResults: number; conversation: number }
  latestRequest?: { input: number; output: number; cacheRead: number; cacheWrite: number }
  estimated?: boolean
}

export function snapshotContextDetails(snapshot: SnapshotEvent) {
  const edits = new Map<number, ContextEdit>()
  for (const entry of snapshot.entries) for (const edit of entry.edits ?? []) edits.set(edit.target, edit)
  const messages: Message[] = snapshot.entries.flatMap(entry => {
    const edit = edits.get(entry.id)
    return edit?.action === 'omit' ? [] : edit?.action === 'replace' ? [...edit.messages] : [...entry.model ?? []]
  }).filter(message => message.role !== 'assistant' || !['error', 'aborted', 'deferred'].includes(message.stopReason))
  const live = snapshot.generation?.message
  if (live && !['error', 'aborted', 'deferred'].includes(live.stopReason)) messages.push(live)
  const estimate = estimateContextTokens(messages)
  const latest = estimate.lastUsageIndex === null ? undefined : messages[estimate.lastUsageIndex]
  const breakdown = { system: 0, tools: 0, files: 0, toolResults: 0, conversation: 0 }
  const system = getCurrentSystemMessage(messages)
  if (system) {
    const sections = { ...system.sections }
    for (const key of ['workspace', 'selected-skills']) {
      const text = sections[key]
      if (text) breakdown.files += estimateTextTokens(text)
      delete sections[key]
    }
    const input = sections['input-context']
    let fileInput = 0
    if (input) {
      const content = input.replace(/^<input-context>\n|\n<\/input-context>$/g, '')
      for (const value of content.split('\n\n')) {
        try {
          const context = JSON.parse(value) as { files?: unknown[] }
          if (context.files?.length) fileInput += estimateTextTokens(JSON.stringify(context.files, null, 2))
        } catch { continue }
      }
    }
    breakdown.files += fileInput
    const text: SystemMessage = { ...system, sections, toolsAdded: undefined, toolsRemoved: undefined }
    breakdown.system = Math.max(0, estimateMessageTokens(text) - fileInput)
    breakdown.tools = system.toolsAdded?.length ? estimateTextTokens(JSON.stringify(system.toolsAdded)) : 0
  }
  for (const message of messages) {
    if (message.role === 'system') continue
    if (message.role === 'toolResult') breakdown.toolResults += estimateMessageTokens(message)
    else if (message.role === 'user' && Array.isArray(message.content)) {
      breakdown.files += estimateMessageTokens({ ...message, content: message.content.filter(part => part.type === 'image') })
      breakdown.conversation += estimateMessageTokens({ ...message, content: message.content.filter(part => part.type === 'text') })
    } else breakdown.conversation += estimateMessageTokens(message)
  }
  return {
    tokens: messages.length ? estimate.tokens : null,
    estimated: estimate.lastUsageIndex === null || estimate.trailingTokens > 0,
    breakdown,
    ...(latest?.role === 'assistant' ? { latestRequest: {
      input: latest.usage.input + latest.usage.cacheRead + latest.usage.cacheWrite,
      output: latest.usage.output,
      cacheRead: latest.usage.cacheRead,
      cacheWrite: latest.usage.cacheWrite,
    } } : {}),
  }
}
