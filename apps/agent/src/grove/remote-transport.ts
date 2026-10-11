import type {
  NetworkBotIdentity,
  RelayEnvelope,
  NetworkTaskRequest,
  TaskOutcome,
  NetworkOperation,
} from '@kklyeenook/shared/bot/social'

export type RemoteSendInput = {
  operationId: string
  fromBotId: string
  toBotId: string
  type: 'message' | 'task'
  content: string
  task?: NetworkTaskRequest
}
export type SocialOutboxEntry = {
  id: string
  kind: 'message' | 'result'
  payload: RemoteSendInput | { operationId: string; outcome: TaskOutcome }
  taskId?: string
  state: 'pending' | 'sent' | 'failed'
  operationId?: string
  error?: string
}

export class RemoteTransportError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export class RemoteTransport {
  readonly url: string
  constructor(
    url: string,
    private readonly credential: () => string | undefined,
  ) {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'https:' &&
      !(
        parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
      )
    )
      throw new Error('Grove Relay requires HTTPS outside localhost')
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error('Relay URL cannot contain credentials or query parameters')
    this.url = parsed.href.replace(/\/$/, '')
  }

  registerBot(localBotId: string, name: string, signal?: AbortSignal) {
    return this.request<NetworkBotIdentity>('/bots', { localBotId, name }, signal)
  }
  directory(signal?: AbortSignal) {
    return this.request<NetworkBotIdentity[]>('/host/bots', undefined, signal)
  }
  send(input: RemoteSendInput, signal?: AbortSignal) {
    return this.request<RelayEnvelope>('/messages', input, signal)
  }
  inbox(signal?: AbortSignal) {
    return this.request<RelayEnvelope[]>('/inbox', undefined, signal)
  }
  acknowledge(messageId: string, signal?: AbortSignal) {
    return this.request<void>(`/inbox/${encodeURIComponent(messageId)}/ack`, {}, signal)
  }
  authorize(operationId: string, signal?: AbortSignal) {
    return this.request<NetworkOperation>(
      `/operations/${encodeURIComponent(operationId)}/authorize`,
      {},
      signal,
    )
  }
  result(operationId: string, outcome: TaskOutcome, signal?: AbortSignal) {
    return this.request<RelayEnvelope>(
      `/operations/${encodeURIComponent(operationId)}/result`,
      outcome,
      signal,
    )
  }

  private async request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const token = this.credential()
    if (!token) throw new RemoteTransportError(401, 'Grove Host credential is not configured')
    const response = await fetch(this.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    }).catch(() => {
      signal?.throwIfAborted()
      throw new RemoteTransportError(0, 'Grove Relay is unavailable')
    })
    if (!response.ok) {
      const message = (await response.json().catch(() => undefined)) as
        | { error?: string }
        | undefined
      throw new RemoteTransportError(
        response.status,
        message?.error ?? 'Grove Relay request failed',
      )
    }
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>)
  }
}
