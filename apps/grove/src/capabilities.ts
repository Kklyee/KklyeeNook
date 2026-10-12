import {
  validateSharedMcp,
  type CapabilityOperation,
  type CapabilityRequest,
  type SharedMcp,
} from '@kklyeenook/shared/bot/capabilities'
import type { NetworkOperation } from '@kklyeenook/shared/bot/social'
import type { GroveDatabase } from './database'
import { GroveError, GroveStore } from './store'

type Row = {
  id: string
  subject_type: 'user' | 'bot'
  subject_id: string
  target_bot_id: string
  action: NetworkOperation['action']
  grant_id: string | null
  state: NetworkOperation['state']
  created_at: string
  updated_at: string
  error: string | null
  capability: SharedMcp
}

export class GroveCapabilities {
  constructor(
    private readonly db: GroveDatabase,
    private readonly store: GroveStore,
  ) {}

  async publish(token: string, botId: string, servers: SharedMcp[]) {
    const host = await this.store.authenticateHost(token)
    const bot = await this.store.getBot(botId)
    if (bot.hostId !== host.id) throw new GroveError(403, 'Bot belongs to another Host')
    for (const server of servers) validateSharedMcp(server)
    if (new Set(servers.map((server) => server.id)).size !== servers.length)
      throw new GroveError(400, 'Duplicate MCP ID')
    await this.db.query('UPDATE network_bots SET shared_mcp=$1 WHERE network_id=$2', [
      JSON.stringify(servers),
      botId,
    ])
  }

  async catalog(token: string) {
    const { bots } = await this.store.connections(token)
    const rows = (
      await this.db.query<{ network_id: string; shared_mcp: SharedMcp[] }>(
        'SELECT network_id,shared_mcp FROM network_bots WHERE network_id=ANY($1::text[])',
        [bots.map((bot) => bot.networkId)],
      )
    ).rows
    return rows.map((row) => ({ botId: row.network_id, servers: row.shared_mcp }))
  }

  async request(token: string, input: CapabilityRequest) {
    try {
      validateSharedMcp(input.server)
    } catch {
      throw new GroveError(400, 'Invalid shared MCP endpoint')
    }
    const operation = await this.store.admit(
      {
        token,
        targetBotId: input.targetBotId,
        action: input.action,
        operationId: input.operationId,
        payload: input.server,
        mcpServerId: input.server.id,
      },
      async (connection, operation) => {
        if (input.action === 'tool.install') {
          const row = (
            await connection.query<{ shared_mcp: SharedMcp[] }>(
              'SELECT shared_mcp FROM network_bots WHERE network_id=$1',
              [input.targetBotId],
            )
          ).rows[0]!
          const approved = row.shared_mcp.find((server) => server.id === input.server.id)
          if (
            !approved ||
            approved.name !== input.server.name ||
            approved.url !== input.server.url ||
            approved.requiresCredentials !== input.server.requiresCredentials
          )
            throw new GroveError(403, 'MCP definition is not in the target Host catalog')
        }
        await connection.query(
          'UPDATE network_operations SET capability=COALESCE(capability,$1) WHERE id=$2',
          [JSON.stringify(input.server), operation.id],
        )
      },
    )
    return { operation, server: input.server }
  }

  async userOperations(token: string) {
    const userId = await this.store.authenticateUser(token)
    return (
      await this.db.query<Row>(
        "SELECT o.* FROM network_operations o JOIN network_bots b ON b.network_id=o.target_bot_id WHERE o.capability IS NOT NULL AND (b.owner_user_id=$1 OR (o.subject_type='user' AND o.subject_id=$1)) ORDER BY o.created_at DESC LIMIT 100",
        [userId],
      )
    ).rows.map(record)
  }

  async inbox(token: string) {
    const host = await this.store.authenticateHost(token)
    return (
      await this.db.query<Row>(
        "SELECT o.* FROM network_operations o JOIN network_bots b ON b.network_id=o.target_bot_id WHERE b.host_id=$1 AND o.capability IS NOT NULL AND o.state IN ('pending','awaiting_approval','installing') ORDER BY o.created_at LIMIT 100",
        [host.id],
      )
    ).rows.map(record)
  }

  async update(token: string, id: string, state: NetworkOperation['state'], error?: string) {
    const host = await this.store.authenticateHost(token)
    return this.db.transaction(async (connection) => {
      const row = (
        await connection.query<Row>(
          'SELECT * FROM network_operations WHERE id=$1 AND capability IS NOT NULL FOR UPDATE',
          [id],
        )
      ).rows[0]
      if (!row) throw new GroveError(404, 'Capability operation not found')
      if ((await this.store.getBot(row.target_bot_id, connection)).hostId !== host.id)
        throw new GroveError(403, 'Operation belongs to another Host')
      if (['completed', 'failed', 'rejected'].includes(row.state)) {
        if (row.state !== state) throw new GroveError(409, 'Capability operation already ended')
        return record(row)
      }
      const allowed =
        row.state === 'pending'
          ? ['awaiting_approval', 'installing', 'failed', 'rejected']
          : row.state === 'awaiting_approval'
            ? ['installing', 'failed', 'rejected']
            : ['completed', 'failed', 'rejected']
      if (!allowed.includes(state)) throw new GroveError(409, 'Invalid capability state transition')
      await connection.query(
        'UPDATE network_operations SET state=$1,error=$2,updated_at=$3 WHERE id=$4',
        [state, error ?? null, Date.now(), id],
      )
      return record({ ...row, state, error: error ?? null, updated_at: String(Date.now()) })
    })
  }
}

function record(row: Row): CapabilityOperation {
  return {
    server: row.capability,
    operation: {
      id: row.id,
      subject: { type: row.subject_type, id: row.subject_id },
      targetBotId: row.target_bot_id,
      action: row.action,
      grantId: row.grant_id ?? undefined,
      state: row.state,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      error: row.error ?? undefined,
    },
  }
}
