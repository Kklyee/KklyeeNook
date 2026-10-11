export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

export function formatToolResult(result: unknown): string {
  if (result === undefined) return ''
  if (!isRecord(result) || !('content' in result)) return stringifyValue(result)

  const { content } = result
  if (!Array.isArray(content)) return stringifyValue(content)

  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (isRecord(part) && typeof part.text === 'string') return part.text
      return stringifyValue(part)
    })
    .join('\n')
}

export function getStringValue(
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

export function getToolSummary(args: unknown, argsText?: string): string {
  if (isRecord(args)) {
    const summary = getStringValue(
      args,
      'path',
      'file_path',
      'command',
      'task',
      'title',
      'kind',
      'name',
      'url',
      'query',
    )
    if (summary) return summary
  }
  if (!argsText) return ''
  let value: unknown
  try {
    value = JSON.parse(argsText)
  } catch {
    return ''
  }
  if (!isRecord(value)) return ''
  return (
    getStringValue(
      value,
      'path',
      'file_path',
      'command',
      'task',
      'title',
      'kind',
      'name',
      'url',
      'query',
    ) ?? ''
  )
}

export function previewText(value: string, maxLines = 24, maxCharacters = 2400): string {
  const clipped = value.slice(0, maxCharacters)
  const preview = clipped.split(/\r?\n/).slice(0, maxLines).join('\n')
  return preview.length < value.length ? `${preview}\n…` : preview
}
