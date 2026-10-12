import { useAui, useAuiState, type TextMessagePartComponent } from '@assistant-ui/react'
import type { BotMention } from '@kklyeenook/shared/bot/mentions'
import { BotMentionChip } from './BotMentionChip'

export const MessageMentionRenderer: TextMessagePartComponent = ({ text }) => {
  const aui = useAui()
  const index = aui.part.query?.type === 'index' ? aui.part.query.index : 0
  const offset = useAuiState((state) =>
    state.message.content
      .slice(0, index)
      .reduce((length, part) => length + (part.type === 'text' ? part.text.length + 1 : 0), 0),
  )
  const data = useAuiState((state) => state.message.metadata.custom.botMentions) as
    | { mentions?: BotMention[] }
    | undefined
  const mentions = (data?.mentions ?? []).filter(
    (mention) => mention.start >= offset && mention.end <= offset + text.length,
  )
  let cursor = 0
  return (
    <span className="whitespace-pre-wrap">
      {mentions.map((mention) => {
        const before = text.slice(cursor, mention.start - offset)
        cursor = mention.end - offset
        return (
          <span key={`${mention.start}:${mention.botId}`}>
            {before}
            <BotMentionChip botId={mention.botId} displayName={mention.displayName} />
          </span>
        )
      })}
      {text.slice(cursor)}
    </span>
  )
}
