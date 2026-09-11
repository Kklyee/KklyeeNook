import { describe, expect, it } from 'vitest'

import { formatToolResult } from './ToolCallRenderer'

describe('formatToolResult', () => {
  it('extracts text from a tool result content array', () => {
    expect(
      formatToolResult({
        content: [
          { type: 'text', text: 'first line' },
          { type: 'text', text: 'second line' },
        ],
        details: {},
      }),
    ).toBe('first line\nsecond line')
  })

  it('falls back to JSON for results without content', () => {
    expect(formatToolResult({ ok: true })).toBe('{\n  "ok": true\n}')
  })
})
