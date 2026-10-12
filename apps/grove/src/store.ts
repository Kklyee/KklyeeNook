import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { SocialAuthorization } from '@kklyeenook/shared/bot/authorization'
import type {
  NetworkBotIdentity,
  NetworkOperation,
  Principal,
  SocialAction,
  SocialGrant,
  SocialRelationship,
} from '@kklyeenook/shared/bot/social'
import type { GroveDatabase, SqlConnection } from './database'
import { GroveCapabilities } from './capabilities'

export class GroveError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message)
  }
}

export type VerifiedHost = { id: string; ownerUserId: string }
type BotRow = {
  network_id: string
  local_bot_id: string
  owner_user_id: string
  host_id: string
  name: string
}
type OperationRow = {
  id: string
  subject_type: Principal['type']
  subject_id: string
  target_bot_id: string
  action: SocialAction
  tool_id: string | null
  mcp_server_id: string | null
  grant_id: string | null
  fingerprint: string
  state: NetworkOperation['state']
  created_at: string
  updated_at: string
  error: string | null
}

export class GroveStore {
  private readonly authorization = new SocialAuthorization()
  readonly capabilities: GroveCapabilities
  constructor(private readonly db: GroveDatabase) {
    this.capabilities = new GroveCapabilities(db, this)
  }

  async provisionUser(name: string) {
    const id = randomUUID()
    const token = randomBytes(32).toString('base64url')
    await this.db.query(
      'INSERT INTO users (id, name, credential_hash, created_at) VALUES ($1,$2,$3,$4)',
      [id, name, hash(token), Date.now()],
    )
    return { id, token }
  }

  async authenticateUser(token: string) {
    const row = (
      await this.db.query<{ id: string }>('SELECT id FROM users WHERE credential_hash=$1', [
        hash(token),
      ])
    ).rows[0]
    if (!row) throw new GroveError(401, 'User authentication failed')
    return row.id
  }

  async authenticateHost(token: string): Promise<VerifiedHost> {
    const row = (
      await this.db.query<{ id: string; owner_user_id: string }>(
        'SELECT id, owner_user_id FROM host_devices WHERE credential_hash=$1 AND disabled_at IS NULL',
        [hash(token)],
      )
    ).rows[0]
    if (!row) throw new GroveError(401, 'Host authentication failed')
    return { id: row.id, ownerUserId: row.owner_user_id }
  }

  async registerHost(userToken: string, name: string) {
    const ownerUserId = await this.authenticateUser(userToken)
    const id = randomUUID()
    const token = randomBytes(32).toString('base64url')
    await this.db.query(
      'INSERT INTO host_devices (id, owner_user_id, name, credential_hash, created_at) VALUES ($1,$2,$3,$4,$5)',
      [id, ownerUserId, name, hash(token), Date.now()],
    )
    return { id, ownerUserId, token }
  }

  async disableHost(userToken: string, id: string) {
    const owner = await this.authenticateUser(userToken)
    const rows = (
      await this.db.query(
        'UPDATE host_devices SET disabled_at=$1 WHERE id=$2 AND owner_user_id=$3 RETURNING id',
        [Date.now(), id, owner],
      )
    ).rows
    if (!rows.length) throw new GroveError(404, 'Host not found')
  }

  async registerBot(
    hostToken: string,
    localBotId: string,
    name: string,
  ): Promise<NetworkBotIdentity> {
    const host = await this.authenticateHost(hostToken)
    const row = (
      await this.db.query<BotRow>(
        'INSERT INTO network_bots (network_id, local_bot_id, owner_user_id, host_id, name) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (host_id, local_bot_id) DO UPDATE SET name=EXCLUDED.name RETURNING *',
        [randomUUID(), localBotId, host.ownerUserId, host.id, name],
      )
    ).rows[0]!
    return botIdentity(row)
  }

  async getBot(id: string, connection: SqlConnection = this.db) {
    const row = (
      await connection.query<BotRow>('SELECT * FROM network_bots WHERE network_id=$1', [id])
    ).rows[0]
    if (!row) throw new GroveError(404, 'Network Bot not found')
    return botIdentity(row)
  }

  async createGrant(
    userToken: string,
    input: Omit<SocialGrant, 'id' | 'issuerUserId' | 'revokedAt'>,
  ): Promise<SocialGrant> {
    const issuerUserId = await this.authenticateUser(userToken)
    const target = await this.getBot(input.targetBotId)
    const grant: SocialGrant = { ...input, id: randomUUID(), issuerUserId }
    try {
      this.authorization.validateGrant({ type: 'user', id: issuerUserId }, target, grant)
    } catch (error) {
      throw new GroveError(403, error instanceof Error ? error.message : 'Invalid grant')
    }
    if (grant.subject.type === 'bot') await this.getBot(grant.subject.id)
    else if (
      !(await this.db.query('SELECT id FROM users WHERE id=$1', [grant.subject.id])).rows.length
    )
      throw new GroveError(404, 'Subject User not found')
    await this.db.query(
      'INSERT INTO social_grants (id, issuer_user_id, subject_type, subject_id, target_bot_id, definition, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        grant.id,
        issuerUserId,
        grant.subject.type,
        grant.subject.id,
        target.networkId,
        JSON.stringify(grant),
        Date.now(),
      ],
    )
    return grant
  }

  async revokeGrant(userToken: string, id: string) {
    const owner = await this.authenticateUser(userToken)
    const result = await this.db.query(
      'UPDATE social_grants SET revoked_at=$1 WHERE id=$2 AND issuer_user_id=$3 RETURNING id',
      [Date.now(), id, owner],
    )
    if (!result.rows.length) throw new GroveError(404, 'Grant not found')
  }

  async invite(userToken: string, recipientUserId: string): Promise<SocialRelationship> {
    const owner = await this.authenticateUser(userToken)
    if (owner === recipientUserId) throw new GroveError(400, 'Cannot invite yourself')
    if (!(await this.db.query('SELECT id FROM users WHERE id=$1', [recipientUserId])).rows.length)
      throw new GroveError(404, 'Recipient User not found')
    const id = hash(JSON.stringify([owner, recipientUserId].sort()))
    const now = Date.now()
    const row = (
      await this.db.query<RelationshipRow>(
        "INSERT INTO relationships (id,requester_user_id,recipient_user_id,state,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (id) DO UPDATE SET requester_user_id=CASE WHEN relationships.state IN ('rejected','revoked') THEN EXCLUDED.requester_user_id ELSE relationships.requester_user_id END, recipient_user_id=CASE WHEN relationships.state IN ('rejected','revoked') THEN EXCLUDED.recipient_user_id ELSE relationships.recipient_user_id END, state=CASE WHEN relationships.state IN ('rejected','revoked') THEN EXCLUDED.state ELSE relationships.state END, updated_at=EXCLUDED.updated_at RETURNING *",
        [id, owner, recipientUserId, 'pending', now],
      )
    ).rows[0]!
    return relationshipRecord(row)
  }

  async decideRelationship(
    userToken: string,
    id: string,
    state: 'accepted' | 'rejected' | 'revoked',
  ) {
    const owner = await this.authenticateUser(userToken)
    const row = (
      await this.db.query<RelationshipRow>(
        "UPDATE relationships SET state=$1,updated_at=$2 WHERE id=$3 AND (($1 IN ('accepted','rejected') AND recipient_user_id=$4 AND state='pending') OR ($1='revoked' AND (recipient_user_id=$4 OR requester_user_id=$4))) RETURNING *",
        [state, Date.now(), id, owner],
      )
    ).rows[0]
    if (!row) throw new GroveError(403, 'Relationship decision is not authorized')
    return relationshipRecord(row)
  }

  async connections(userToken: string) {
    const owner = await this.authenticateUser(userToken)
    const relationships = (
      await this.db.query<RelationshipRow>(
        'SELECT * FROM relationships WHERE requester_user_id=$1 OR recipient_user_id=$1 ORDER BY updated_at DESC',
        [owner],
      )
    ).rows.map(relationshipRecord)
    const bots = await this.directory(owner)
    const grants = (
      await this.db.query<{ definition: SocialGrant; revoked_at: string | null; created_at: string }>(
        'SELECT definition,revoked_at,created_at FROM social_grants WHERE issuer_user_id=$1 ORDER BY created_at DESC',
        [owner],
      )
    ).rows.map((row) => ({
      ...row.definition,
      createdAt: Number(row.created_at),
      ...(row.revoked_at !== null ? { revokedAt: Number(row.revoked_at) } : {}),
    }))
    return { userId: owner, relationships, bots, grants }
  }

  async hostDirectory(hostToken: string) {
    return this.directory((await this.authenticateHost(hostToken)).ownerUserId)
  }

  private async directory(owner: string) {
    return (
      await this.db.query<BotRow>(
        "SELECT b.* FROM network_bots b JOIN host_devices h ON h.id=b.host_id AND h.disabled_at IS NULL WHERE b.owner_user_id=$1 OR EXISTS (SELECT 1 FROM relationships r WHERE r.state='accepted' AND ((r.requester_user_id=$1 AND r.recipient_user_id=b.owner_user_id) OR (r.recipient_user_id=$1 AND r.requester_user_id=b.owner_user_id))) ORDER BY b.name,b.network_id",
        [owner],
      )
    ).rows.map(botIdentity)
  }

  async admit(
    input: {
      token: string
      fromBotId?: string
      targetBotId: string
      action: SocialAction
      operationId: string
      payload: unknown
      toolId?: string
      mcpServerId?: string
      taskOperationId?: string
    },
    enqueue?: (connection: SqlConnection, operation: NetworkOperation) => Promise<void>,
  ): Promise<NetworkOperation> {
    let subject: Principal
    let ownerUserId: string
    if (input.taskOperationId) {
      const task = await this.revalidate(input.token, input.taskOperationId)
      if (
        task.action !== 'task.request' ||
        task.subject.type !== 'bot' ||
        task.targetBotId !== input.targetBotId ||
        input.action !== 'tool.invoke' ||
        task.state !== 'pending'
      )
        throw new GroveError(403, 'Invocation does not match an active remote task')
      const request = (
        await this.db.query<{ deadline: string }>(
          "SELECT payload->'task'->>'deadline' AS deadline FROM network_messages WHERE id=$1 AND type='task'",
          [task.id],
        )
      ).rows[0]
      if (!request || Number(request.deadline) <= Date.now())
        throw new GroveError(403, 'Collaboration time budget exhausted')
      subject = task.subject
      ownerUserId = (await this.getBot(subject.id)).ownerUserId
    } else if (input.fromBotId) {
      const host = await this.authenticateHost(input.token)
      const bot = await this.getBot(input.fromBotId)
      if (bot.hostId !== host.id || bot.ownerUserId !== host.ownerUserId)
        throw new GroveError(403, 'Host does not own the sending Bot')
      subject = { type: 'bot', id: bot.networkId }
      ownerUserId = host.ownerUserId
    } else {
      ownerUserId = await this.authenticateUser(input.token)
      subject = { type: 'user', id: ownerUserId }
    }
    if (!input.operationId.trim()) throw new GroveError(400, 'Operation ID is required')
    const id = hash(JSON.stringify([subject, input.operationId]))
    const fingerprint = hash(
      JSON.stringify([
        input.targetBotId,
        input.action,
        input.payload,
        input.toolId ?? null,
        input.mcpServerId ?? null,
      ]),
    )
    return this.db.transaction(async (connection) => {
      await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id])
      const existing = (
        await connection.query<OperationRow>('SELECT * FROM network_operations WHERE id=$1', [id])
      ).rows[0]
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new GroveError(409, 'Operation ID already used with different input')
        const operation = operationRecord(existing)
        await enqueue?.(connection, operation)
        return operation
      }
      const target = await this.getBot(input.targetBotId, connection)
      const grants = (
        await connection.query<{ definition: SocialGrant; revoked_at: string | null }>(
          'SELECT definition, revoked_at FROM social_grants WHERE target_bot_id=$1 AND subject_type=$2 AND subject_id=$3 ORDER BY id FOR UPDATE',
          [target.networkId, subject.type, subject.id],
        )
      ).rows.map((row) => ({
        ...row.definition,
        ...(row.revoked_at !== null ? { revokedAt: Number(row.revoked_at) } : {}),
      }))
      const counts = (
        await connection.query<{ grant_id: string; uses: string }>(
          'SELECT grant_id, count(*) AS uses FROM network_operations WHERE grant_id=ANY($1::text[]) GROUP BY grant_id',
          [grants.map((grant) => grant.id)],
        )
      ).rows
      const now = Date.now()
      const decision = this.authorization.evaluate(
        {
          subject,
          subjectOwnerUserId: ownerUserId,
          target,
          action: input.action,
          toolId: input.toolId,
          mcpServerId: input.mcpServerId,
        },
        grants,
        Object.fromEntries(counts.map((row) => [row.grant_id, Number(row.uses)])),
        now,
      )
      if (!decision.allowed) throw new GroveError(403, decision.reason)
      const row = (
        await connection.query<OperationRow>(
          'INSERT INTO network_operations (id, subject_type, subject_id, target_bot_id, action, grant_id, fingerprint, state, created_at, updated_at, tool_id, mcp_server_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11) RETURNING *',
          [
            id,
            subject.type,
            subject.id,
            target.networkId,
            input.action,
            decision.grantId ?? null,
            fingerprint,
            'pending',
            now,
            input.toolId ?? null,
            input.mcpServerId ?? null,
          ],
        )
      ).rows[0]!
      const operation = operationRecord(row)
      await enqueue?.(connection, operation)
      return operation
    })
  }

  async revalidate(hostToken: string, operationId: string): Promise<NetworkOperation> {
    const host = await this.authenticateHost(hostToken)
    const row = (
      await this.db.query<OperationRow>('SELECT * FROM network_operations WHERE id=$1', [
        operationId,
      ])
    ).rows[0]
    if (!row) throw new GroveError(404, 'Operation not found')
    const target = await this.getBot(row.target_bot_id)
    if (target.hostId !== host.id) throw new GroveError(403, 'Operation belongs to another Host')
    let owner = row.subject_id
    if (row.subject_type === 'bot') {
      const source = await this.getBot(row.subject_id)
      owner = source.ownerUserId
      const active =
        (
          await this.db.query('SELECT id FROM host_devices WHERE id=$1 AND disabled_at IS NULL', [
            source.hostId,
          ])
        ).rows.length > 0
      if (!active) throw new GroveError(403, 'Sending Host has been disabled')
    }
    const grants: SocialGrant[] = []
    if (row.grant_id) {
      const record = (
        await this.db.query<{ definition: SocialGrant; revoked_at: string | null }>(
          'SELECT definition, revoked_at FROM social_grants WHERE id=$1',
          [row.grant_id],
        )
      ).rows[0]
      if (record)
        grants.push({
          ...record.definition,
          ...(record.revoked_at !== null ? { revokedAt: Number(record.revoked_at) } : {}),
        })
    }
    const decision = this.authorization.evaluate(
      {
        subject: { type: row.subject_type, id: row.subject_id },
        subjectOwnerUserId: owner,
        target,
        action: row.action,
        toolId: row.tool_id ?? undefined,
        mcpServerId: row.mcp_server_id ?? undefined,
      },
      grants,
      {},
      Date.now(),
    )
    if (!decision.allowed) throw new GroveError(403, decision.reason)
    return operationRecord(row)
  }
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
function botIdentity(row: BotRow): NetworkBotIdentity {
  return {
    networkId: row.network_id,
    localBotId: row.local_bot_id,
    ownerUserId: row.owner_user_id,
    hostId: row.host_id,
    name: row.name,
  }
}
function operationRecord(row: OperationRow): NetworkOperation {
  return {
    id: row.id,
    subject: { type: row.subject_type, id: row.subject_id },
    targetBotId: row.target_bot_id,
    action: row.action,
    grantId: row.grant_id ?? undefined,
    state: row.state,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    error: row.error ?? undefined,
  }
}

type RelationshipRow = {
  id: string
  requester_user_id: string
  recipient_user_id: string
  state: SocialRelationship['state']
  created_at: string
  updated_at: string
}
function relationshipRecord(row: RelationshipRow): SocialRelationship {
  return {
    id: row.id,
    requesterUserId: row.requester_user_id,
    recipientUserId: row.recipient_user_id,
    state: row.state,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}
