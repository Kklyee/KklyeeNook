import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'

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

test('HTTP MCP discovers and calls tools with owner credentials and refuses redirects', async () => {
  const auth: Array<string | undefined> = []
  const server = createServer(async (request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/mcp' })
      response.end()
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405)
      response.end()
      return
    }
    auth.push(request.headers.authorization)
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString())
    if (input.id === undefined) {
      response.writeHead(202)
      response.end()
      return
    }
    const result =
      input.method === 'initialize'
        ? {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'http-fixture', version: '1' },
          }
        : input.method === 'tools/list'
          ? { tools: [{ name: 'inspect', inputSchema: { type: 'object' } }] }
          : { content: [{ type: 'text', text: 'HTTP result' }] }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  const config = {
    id: 'http',
    name: 'HTTP',
    enabled: true,
    transport: 'http' as const,
    command: '',
    args: [],
    url: `http://127.0.0.1:${address.port}/mcp`,
    requiresCredentials: true,
  }
  const missing = new McpClientConnection(config)
  const connection = new McpClientConnection(config, undefined, undefined, () => 'owner-secret')
  const redirect = new McpClientConnection({
    ...config,
    requiresCredentials: false,
    url: `http://127.0.0.1:${address.port}/redirect`,
  })
  try {
    await expect(missing.connect()).rejects.toThrow('owner credentials')
    expect(auth).toEqual([])
    await connection.connect()
    expect((await connection.listTools())[0].name).toBe('inspect')
    expect(await connection.callTool('inspect', {})).toMatchObject({
      content: [{ text: 'HTTP result' }],
    })
    expect(auth.every((value) => value === 'Bearer owner-secret')).toBe(true)
    await expect(redirect.connect()).rejects.toThrow()
  } finally {
    await Promise.all([connection.close(), redirect.close(), missing.close()])
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
