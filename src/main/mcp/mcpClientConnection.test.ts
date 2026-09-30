import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'

import { McpClientConnection } from './mcpClientConnection'

const directory = mkdtempSync(join(tmpdir(), 'kklyeenook-mcp-'))
const script = join(directory, 'server.cjs')
writeFileSync(
  script,
  `
const readline = require('node:readline')
const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  let result
  if (request.method === 'initialize') {
    result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } }
  } else if (request.method === 'tools/list') {
    result = { tools: [{ name: request.params?.cursor ? 'second' : 'first', inputSchema: { type: 'object' } }] }
    if (!request.params?.cursor) result.nextCursor = 'page-two'
  } else if (request.method === 'tools/call') {
    result = { content: [{ type: 'text', text: JSON.stringify({ cwd: process.cwd(), env: process.env.MCP_TEST, args: process.argv.slice(2), pid: process.pid }) }] }
  } else return
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n')
})
input.on('close', () => process.exit(0))
`,
)

afterAll(() => rmSync(directory, { recursive: true, force: true }))

test('connects a real stdio process, discovers every page, passes configuration and closes it', async () => {
  const connection = new McpClientConnection({
    id: 'fixture',
    name: 'Fixture',
    enabled: true,
    transport: 'stdio',
    command: process.execPath,
    args: [script, ' argument with spaces ', ''],
    env: { MCP_TEST: 'value with spaces' },
    cwd: directory,
  })
  let pid: number | undefined
  try {
    await connection.connect()
    expect((await connection.listTools()).map((tool) => tool.name)).toEqual(['first', 'second'])
    const result = await connection.callTool('first', {})
    const block = result.content[0]
    if (block.type !== 'text') throw new Error('Expected a text response')
    const data = JSON.parse(block.text as string)
    pid = data.pid
    expect(data).toMatchObject({
      cwd: directory,
      env: 'value with spaces',
      args: [' argument with spaces ', ''],
    })
  } finally {
    await connection.close()
  }
  expect(pid).toBeTypeOf('number')
  expect(() => process.kill(pid!, 0)).toThrow()
})
