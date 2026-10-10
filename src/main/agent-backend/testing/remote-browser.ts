export async function verifyRemote() {
  const wait = async (condition: () => unknown | Promise<unknown>) => {
    const until = Date.now() + 20000
    while (Date.now() < until) {
      const value = await condition()
      if (value) return value
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Remote condition timed out: ' + condition.toString() + ' ' + document.body.innerText.slice(0, 1000))
  }
  const api = async (path: string, body?: unknown) => {
    const response = await fetch('/api' + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) throw new Error('Remote API ' + response.status + ' ' + path)
    return response.json()
  }
  const enter = async (text: string) => {
    const input = await wait(() => document.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)')) as HTMLTextAreaElement
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const button = async (label: string) => await wait(() => [...document.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].find(button => button.textContent?.trim() === label)) as HTMLButtonElement
  await wait(() => document.querySelector('.mobile-project-row'))
  const projects = await api('/projects')
  if (projects.length !== 1) throw new Error('Remote project ownership was not preserved')
  const projectId = projects[0].id
  if ((await api('/state')).defaults.permission !== 'read-only') throw new Error('Remote default permission changed after settings rollback')
  const project = document.querySelector<HTMLButtonElement>('.mobile-project-row')!
  project.click()
  ;(await button('New')).click()
  await enter('Remote first request')
  const originalFetch = window.fetch.bind(window)
  const retriedBodies: string[] = []
  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init)
    if (input === `/api/projects/${projectId}/conversations` && init?.method === 'POST') {
      retriedBodies.push(String(init.body))
      if (retriedBodies.length === 1) throw new Error('Acceptance acknowledgement lost')
    }
    return response
  }
  const send = await wait(() => document.querySelector<HTMLButtonElement>('[aria-label="Send message"]:not(:disabled)')) as HTMLButtonElement
  send.click()
  await wait(() => document.body.innerText.includes('Acceptance acknowledgement lost'))
  await enter('Remote first request')
  ;(await wait(() => document.querySelector<HTMLButtonElement>('[aria-label="Send message"]:not(:disabled)')) as HTMLButtonElement).click()
  await wait(() => document.body.innerText.includes('Production host accepted.'))
  window.fetch = originalFetch
  if (retriedBodies.length !== 2 || retriedBodies[0] !== retriedBodies[1] || !JSON.parse(retriedBodies[0]).requestId) throw new Error('Remote retry changed the original admission')
  await wait(async () => {
    const conversations = await api(`/projects/${projectId}/conversations`)
    return conversations.find(conversation => !conversation.historical && conversation.status === 'idle')
  })
  const first = (await api(`/projects/${projectId}/conversations`)).find(conversation => !conversation.historical)
  if ((await api(`/projects/${projectId}/conversations`)).filter(conversation => !conversation.historical).length !== 1 || first.id !== `remote-${JSON.parse(retriedBodies[0]).requestId}`) throw new Error('Remote retry created a duplicate conversation')
  const id = first.id
  await api(`/conversations/${id}/model`, { provider: 'test-provider', modelId: 'alternate-model' })
  await api(`/conversations/${id}/thinking`, { thinkingLevel: 'low' })
  await api(`/conversations/${id}/permission`, { permission: 'read-only' })
  const configured = await api(`/conversations/${id}`)
  if (configured.model.modelId !== 'alternate-model' || configured.thinkingLevel !== 'low' || configured.permission !== 'read-only' || configured.contextUsage.contextWindow !== 65536) throw new Error('Remote model, thinking, permission or capacity was not preserved')
  await wait(() => document.querySelector('[aria-label="Model and thinking level"]')?.textContent?.includes('Alternate'))
  await enter('approval-effect')
  ;(await wait(() => document.querySelector<HTMLButtonElement>('[aria-label="Send message"]:not(:disabled)')) as HTMLButtonElement).click()
  await wait(() => document.body.innerText.includes('Allow once'))
  await enter('Remote queued steer')
  const steer = await wait(() => document.querySelector<HTMLButtonElement>('[aria-label="Steer current task"]:not(:disabled)')) as HTMLButtonElement
  steer.click()
  await wait(async () => (await api(`/conversations/${id}`)).queue.some(item => item.text === 'Remote queued steer'))
  const busy = await fetch(`/api/conversations/${id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Busy conflict', mode: 'normal' }) })
  if (busy.status !== 409) throw new Error('Remote busy request was not a conflict')
  ;(await wait(() => document.querySelector<HTMLButtonElement>('[aria-label="Stop Agent"]:not(:disabled)')) as HTMLButtonElement).click()
  await wait(async () => {
    const snapshot = await api(`/conversations/${id}`)
    return snapshot.status === 'idle' && !snapshot.queue.length && !snapshot.approvals.length
  })
  ;(await wait(() => document.querySelector<HTMLButtonElement>('[aria-label="New conversation"]')) as HTMLButtonElement).click()
  await wait(() => document.querySelector('h1')?.textContent === 'New Conversation')
  await enter('approval-effect')
  ;(await wait(() => document.querySelector<HTMLButtonElement>('[aria-label="Send message"]:not(:disabled)')) as HTMLButtonElement).click()
  await wait(() => document.body.innerText.includes('Allow once'))
  ;(await button('Allow once')).click()
  await wait(() => document.body.innerText.includes('Production host accepted.'))
  const second = await wait(async () => {
    const conversations = await api(`/projects/${projectId}/conversations`)
    return conversations.find(conversation => !conversation.historical && conversation.id !== id && conversation.status === 'idle')
  }) as { id: string }
  const completed = await api(`/conversations/${second.id}`)
  if (!completed.activities.some(activity => activity.toolCallId === 'effect-call' && activity.status === 'completed')) throw new Error('Completed remote tool activity disappeared')
  const publicState = JSON.stringify(completed).replace(/\\/g, '/')
  for (const secret of ['synthetic-key', '/sessions/', 'textSignature', 'thinkingSignature']) if (publicState.includes(secret)) throw new Error('Remote exposed private execution data')
  location.hash = `/projects/${projectId}/conversations/historical-thread`
  await wait(() => document.body.innerText.includes('Historical remote answer'))
  const historical = await api('/conversations/historical-thread')
  if (!historical.historical || !document.querySelector<HTMLTextAreaElement>('textarea')?.disabled) throw new Error('Remote history was not read-only')
  ;(await button('在新会话中继续')).click()
  const continued = await wait(() => location.hash !== `#/projects/${projectId}/conversations/historical-thread` && location.hash.includes('/conversations/'))
  if (!continued) throw new Error('Remote history did not continue explicitly')
  const continuationId = location.hash.split('/').at(-1)!
  const continuation = await api(`/conversations/${continuationId}`)
  if (continuation.historical || continuation.permission !== 'read-only' || !JSON.stringify(continuation.messages).includes('Historical remote answer')) throw new Error('Remote continuation changed the frozen context or permission')
  return { sent: true, queue: true, cancel: true, approval: true, configuration: true, history: true, threadId: second.id, continuationId }
}
