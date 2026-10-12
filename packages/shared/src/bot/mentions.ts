import type { BotAvatarConfig } from './bot'

export type BotMention = { botId: string; displayName: string; start: number; end: number }
export type MentionTarget = {
  botId: string
  name: string
  role: string
  avatar?: BotAvatarConfig
  source: 'local' | 'remote'
  owned: boolean
  allowed: boolean
  online: boolean
  reason?: string
}
type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; type: string; label: string; id: string }

export const botMentionFormatter = {
  serialize: (item: { id: string; label: string }) =>
    `:bot[${encodeURIComponent(item.label)}]{id=${encodeURIComponent(item.id)}}`,
  parse(text: string): Segment[] {
    const segments: Segment[] = []
    let cursor = 0
    for (const match of text.matchAll(/:bot\[([^\]\n]+)\]\{id=([^}\n]+)\}/g)) {
      try {
        const label = decodeURIComponent(match[1])
        const id = decodeURIComponent(match[2])
        if (!label || !id) continue
        if (match.index > cursor)
          segments.push({ kind: 'text', text: text.slice(cursor, match.index) })
        segments.push({ kind: 'mention', type: 'bot', label, id })
        cursor = match.index + match[0].length
      } catch {
        continue
      }
    }
    if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
    return segments
  },
}

export function decodeBotMentions(value: string) {
  let text = ''
  const mentions: BotMention[] = []
  for (const part of botMentionFormatter.parse(value)) {
    if (part.kind === 'text') text += part.text
    else {
      const start = text.length
      text += `@${part.label}`
      mentions.push({ botId: part.id, displayName: part.label, start, end: text.length })
    }
  }
  return { text, mentions }
}

export function validateBotMentions(text: string, mentions: readonly BotMention[]) {
  if (mentions.length > 3) throw new Error('每条消息最多提及 3 个 Bot')
  let end = 0
  for (const mention of mentions) {
    if (
      !mention.botId.trim() ||
      !mention.displayName.trim() ||
      !Number.isSafeInteger(mention.start) ||
      !Number.isSafeInteger(mention.end) ||
      mention.start < end ||
      mention.end <= mention.start ||
      text.slice(mention.start, mention.end) !== `@${mention.displayName}`
    )
      throw new Error('Invalid structured Bot mention')
    end = mention.end
  }
}
