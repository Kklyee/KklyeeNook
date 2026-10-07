export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const request: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  }
  const response = await fetch(`/api${path}`, request)
  const data = await response.json()
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'Request failed')
  return data as T
}
