import type { BotMessage } from '@kklyeenook/shared/bot/grove'
import { GROVE_LIMITS } from '@kklyeenook/shared/bot/grove'
import type { NetworkTaskRequest, RelayEnvelope, TaskOutcome } from '@kklyeenook/shared/bot/social'
import type { GroveDatabase, SqlConnection } from './database'
import { GroveError, GroveStore } from './store'

type MessagePayload = { message: BotMessage; task?: NetworkTaskRequest; outcome?: TaskOutcome }
type MessageRow = {
  id: string
  operation_id: string
  source_host_id: string
  recipient_host_id: string
  from_bot_id: string
  to_bot_id: string
  type: BotMessage['type']
  payload: MessagePayload
}

export class GroveRelay {
  constructor(
    private readonly db: GroveDatabase,
    private readonly store: GroveStore,
  ) {}

  async send(
    token: string,
    input: {
      operationId: string
      fromBotId: string
      toBotId: string
      type: 'message' | 'task'
      content: string
      task?: NetworkTaskRequest
    },
  ): Promise<RelayEnvelope> {
    if (!input.content.trim() || input.content.length > 64000)
      throw new GroveError(400, 'Invalid message content')
    const host = await this.store.authenticateHost(token)
    const sender = await this.store.getBot(input.fromBotId)
    const target = await this.store.getBot(input.toBotId)
    if (sender.hostId !== host.id) throw new GroveError(403, 'Host does not own the sending Bot')
    if (sender.networkId === target.networkId)
      throw new GroveError(403, 'A Bot cannot request itself')
    const now = Date.now()
    if (
      input.type === 'task' &&
      (!input.task ||
        input.task.depth !== 1 ||
        !Number.isSafeInteger(input.task.deadline) ||
        input.task.deadline > now + GROVE_LIMITS.timeoutMs ||
        !input.task.taskId ||
        !input.task.chainId)
    )
      throw new GroveError(
        400,
        'Invalid remote collaboration budget; recursive remote delegation is disabled',
      )
    if (input.type === 'message' && input.task)
      throw new GroveError(400, 'Ordinary messages cannot carry a task')
    const operation = await this.store.admit(
      {
        token,
        fromBotId: sender.networkId,
        targetBotId: target.networkId,
        action: input.type === 'task' ? 'task.request' : 'message.send',
        operationId: input.operationId,
        payload: {
          type: input.type,
          content: input.content,
          ...(input.task ? { task: input.task } : {}),
        },
      },
      async (connection, operation) => {
        for (const botId of [sender.networkId, target.networkId].sort())
          await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
            `grove-bot:${botId}`,
          ])
        const existing =
          (await connection.query('SELECT id FROM network_messages WHERE id=$1', [operation.id]))
            .rows.length > 0
        if (!existing) {
          if (input.type === 'task' && input.task!.deadline <= now)
            throw new GroveError(400, 'Collaboration time budget exhausted')
          const recent = (
            await connection.query<{ count: string }>(
              'SELECT count(*) FROM network_messages WHERE from_bot_id=$1 AND type <> $2 AND created_at>$3',
              [sender.networkId, 'result', now - 60_000],
            )
          ).rows[0]!
          if (Number(recent.count) >= GROVE_LIMITS.messagesPerMinute)
            throw new GroveError(403, 'Bot message rate limit exceeded')
          if (input.type === 'task') {
            const active = (
              await connection.query<{ count: string }>(
                "SELECT count(*) FROM network_operations o JOIN network_messages m ON m.operation_id=o.id AND m.type='task' WHERE o.target_bot_id=$1 AND o.action=$2 AND o.state=$3 AND (m.payload->'task'->>'deadline')::bigint>$4",
                [target.networkId, 'task.request', 'pending', now],
              )
            ).rows[0]!
            if (Number(active.count) >= GROVE_LIMITS.activePerBot)
              throw new GroveError(403, 'Target Bot queue is full')
          }
        }
        const payload: MessagePayload = {
          message: {
            id: operation.id,
            fromBotId: sender.networkId,
            toBotId: target.networkId,
            type: input.type,
            content: input.content,
            ...(input.type === 'task' ? { correlationId: operation.id } : {}),
            createdAt: operation.createdAt,
          },
          ...(input.task ? { task: input.task } : {}),
        }
        await connection.query(
          'INSERT INTO network_messages (id, operation_id, source_host_id, recipient_host_id, from_bot_id, to_bot_id, type, payload, created_at) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING',
          [
            operation.id,
            host.id,
            target.hostId,
            sender.networkId,
            target.networkId,
            input.type,
            JSON.stringify(payload),
            operation.createdAt,
          ],
        )
      },
    )
    return this.envelope(
      (
        await this.db.query<MessageRow>('SELECT * FROM network_messages WHERE id=$1', [
          operation.id,
        ])
      ).rows[0]!,
      operation,
    )
  }

  async inbox(token: string): Promise<RelayEnvelope[]> {
    const host = await this.store.authenticateHost(token)
    const rows = (
      await this.db.query<MessageRow>(
        'SELECT * FROM network_messages WHERE recipient_host_id=$1 AND received_at IS NULL ORDER BY created_at,id LIMIT 100',
        [host.id],
      )
    ).rows
    const envelopes: RelayEnvelope[] = []
    for (const row of rows) {
      if (row.type !== 'result') {
        if (row.type === 'task' && row.payload.task!.deadline <= Date.now()) {
          await this.reject(row, 'Collaboration time budget exhausted')
          continue
        }
        try {
          const operation = await this.store.revalidate(token, row.operation_id)
          envelopes.push(await this.envelope(row, operation))
        } catch (error) {
          if (!(error instanceof GroveError) || error.status !== 403) throw error
          await this.reject(row, error.message)
        }
      } else {
        const operation = await this.operation(row.operation_id)
        envelopes.push(await this.envelope(row, operation))
      }
    }
    return envelopes
  }

  async acknowledge(token: string, messageId: string) {
    const host = await this.store.authenticateHost(token)
    const row = (
      await this.db.query<MessageRow>(
        'SELECT * FROM network_messages WHERE id=$1 AND recipient_host_id=$2',
        [messageId, host.id],
      )
    ).rows[0]
    if (!row) throw new GroveError(404, 'Message not found')
    await this.db.transaction(async (connection) => {
      await connection.query(
        'UPDATE network_messages SET received_at=COALESCE(received_at,$1) WHERE id=$2',
        [Date.now(), messageId],
      )
      if (row.type === 'message')
        await connection.query(
          'UPDATE network_operations SET state=$1, updated_at=$2 WHERE id=$3 AND state=$4',
          ['completed', Date.now(), row.operation_id, 'pending'],
        )
    })
  }

  async result(token: string, operationId: string, outcome: TaskOutcome): Promise<RelayEnvelope> {
    const host = await this.store.authenticateHost(token)
    const request = (
      await this.db.query<MessageRow>(
        'SELECT * FROM network_messages WHERE id=$1 AND type=$2 AND recipient_host_id=$3',
        [operationId, 'task', host.id],
      )
    ).rows[0]
    if (!request) throw new GroveError(404, 'Task request not found')
    if (
      !['completed', 'failed', 'rejected'].includes(outcome.status) ||
      outcome.result.length > 64000
    )
      throw new GroveError(400, 'Invalid task outcome')
    await this.db.transaction((connection) => this.putResult(connection, request, outcome))
    const row = (
      await this.db.query<MessageRow>('SELECT * FROM network_messages WHERE id=$1', [
        `${operationId}:result`,
      ])
    ).rows[0]!
    return this.envelope(row, await this.operation(operationId))
  }

  private async reject(row: MessageRow, reason: string) {
    await this.db.transaction(async (connection) => {
      if (row.type === 'task')
        await this.putResult(connection, row, { status: 'rejected', result: reason })
      else
        await connection.query(
          'UPDATE network_operations SET state=$1,error=$2,updated_at=$3 WHERE id=$4 AND state=$5',
          ['rejected', reason, Date.now(), row.operation_id, 'pending'],
        )
      await connection.query(
        'UPDATE network_messages SET received_at=COALESCE(received_at,$1) WHERE id=$2',
        [Date.now(), row.id],
      )
    })
  }

  private async putResult(connection: SqlConnection, request: MessageRow, outcome: TaskOutcome) {
    await connection.query('SELECT id FROM network_operations WHERE id=$1 FOR UPDATE', [
      request.operation_id,
    ])
    const id = `${request.operation_id}:result`
    const existing = (
      await connection.query<MessageRow>('SELECT * FROM network_messages WHERE id=$1', [id])
    ).rows[0]
    if (existing) {
      if (
        existing.payload.outcome?.status !== outcome.status ||
        existing.payload.outcome.result !== outcome.result
      )
        throw new GroveError(409, 'Task result already recorded with different content')
      return
    }
    const now = Date.now()
    const payload: MessagePayload = {
      message: {
        id,
        fromBotId: request.to_bot_id,
        toBotId: request.from_bot_id,
        type: 'result',
        content: outcome.result,
        correlationId: request.operation_id,
        createdAt: now,
      },
      outcome,
    }
    await connection.query(
      'INSERT INTO network_messages (id, operation_id, source_host_id, recipient_host_id, from_bot_id, to_bot_id, type, payload, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        id,
        request.operation_id,
        request.recipient_host_id,
        request.source_host_id,
        request.to_bot_id,
        request.from_bot_id,
        'result',
        JSON.stringify(payload),
        now,
      ],
    )
    await connection.query(
      'UPDATE network_operations SET state=$1,error=$2,updated_at=$3 WHERE id=$4',
      [
        outcome.status,
        outcome.status === 'completed' ? null : outcome.result,
        now,
        request.operation_id,
      ],
    )
    await connection.query(
      'UPDATE network_messages SET received_at=COALESCE(received_at,$1) WHERE id=$2',
      [now, request.id],
    )
  }

  private async envelope(
    row: MessageRow,
    operation: RelayEnvelope['operation'],
  ): Promise<RelayEnvelope> {
    return {
      ...row.payload,
      operation,
      sender: await this.store.getBot(row.from_bot_id),
      target: await this.store.getBot(row.to_bot_id),
      sourceHostId: row.source_host_id,
    }
  }

  private async operation(id: string): Promise<RelayEnvelope['operation']> {
    const row = (
      await this.db.query<{
        id: string
        subject_type: 'user' | 'bot'
        subject_id: string
        target_bot_id: string
        action: RelayEnvelope['operation']['action']
        grant_id: string | null
        state: RelayEnvelope['operation']['state']
        created_at: string
        updated_at: string
        error: string | null
      }>('SELECT * FROM network_operations WHERE id=$1', [id])
    ).rows[0]!
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
}
