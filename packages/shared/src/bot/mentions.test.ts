import { expect, test } from 'vitest'
import { botMentionFormatter, decodeBotMentions, validateBotMentions } from './mentions'

test('Bot tokens preserve stable IDs, escaped names and ranges in the middle of text', () => {
  const token = botMentionFormatter.serialize({ id: 'bot:stable-id', label: 'Coder [] 中文' })
  const result = decodeBotMentions(`先看看 ${token} 请检查代码。`)
  expect(result.text).toBe('先看看 @Coder [] 中文 请检查代码。')
  expect(result.mentions).toEqual([
    { botId: 'bot:stable-id', displayName: 'Coder [] 中文', start: 4, end: 16 },
  ])
  expect(() => validateBotMentions(result.text, result.mentions)).not.toThrow()
  expect(decodeBotMentions('@Coder 普通文本').mentions).toEqual([])
  expect(decodeBotMentions(':bot[bad%FF]{id=stable}').mentions).toEqual([])
})

test('mention validation rejects broken ranges, overlaps and more than three tokens', () => {
  const { text, mentions } = decodeBotMentions(
    botMentionFormatter.serialize({ id: 'coder', label: 'Coder' }),
  )
  expect(() => validateBotMentions(text, [{ ...mentions[0], start: 1 }])).toThrow('structured')
  expect(() => validateBotMentions(text, [mentions[0], mentions[0]])).toThrow('structured')
  expect(() => validateBotMentions(text, Array(4).fill(mentions[0]))).toThrow('3')
})
