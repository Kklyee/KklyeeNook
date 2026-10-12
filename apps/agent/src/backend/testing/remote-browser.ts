export async function verifyRemote(alternateModelId = 'alternate-model') {
  const wait = async (condition: () => unknown | Promise<unknown>) => {
    const until = Date.now() + 20000
    while (Date.now() < until) {
      const value = await condition()
      if (value) return value
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(
      'Remote condition timed out: ' +
        condition.toString() +
        ' ' +
        document.body.innerText.slice(0, 1000),
    )
  }
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(
      '/api' + path,
      body === undefined
        ? undefined
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    )
    if (!response.ok)
      throw new Error('Remote API ' + response.status + ' ' + path + ' ' + (await response.text()))
    return response.json()
  }
  const enter = async (text: string) => {
    const input = (await wait(() =>
      document.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)'),
    )) as HTMLTextAreaElement
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const button = async (label: string) =>
    (await wait(() =>
      [...document.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].find(
        (button) => button.textContent?.trim() === label,
      ),
    )) as HTMLButtonElement
  await wait(() => document.body.innerText.includes('MY BOTS'))
  const projects = await api('/projects')
  if (projects.length !== 1) throw new Error('Remote project ownership was not preserved')
  const projectId = projects[0].id
  const authorizedBot = await fetch('/api/bots/coder', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Coder', workspaceIds: [projectId], enabledTools: ['write'] }),
  })
  if (!authorizedBot.ok) throw new Error('Remote Bot authorization failed')
  const main = await api('/bots/coder/main', {})
  if ((await api('/bots/coder/main', {})).id !== main.id)
    throw new Error('Remote main Thread is not unique')
  const created = await api('/bots/coder/conversations', {
    workspaceId: projectId,
    requestId: 'remote-first-thread',
  })
  const id = created.id
  location.hash = '/bots/coder/conversations/' + id
  await enter('Remote first request')
  const originalFetch = window.fetch.bind(window)
  const retriedBodies: string[] = []
  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init)
    if (input === '/api/conversations/' + id + '/messages' && init?.method === 'POST') {
      retriedBodies.push(String(init.body))
      if (retriedBodies.length === 1) throw new Error('Acceptance acknowledgement lost')
    }
    return response
  }
  const send = (await wait(() =>
    document.querySelector<HTMLButtonElement>('[aria-label="Send message"]:not(:disabled)'),
  )) as HTMLButtonElement
  send.click()
  await wait(() => document.body.innerText.includes('Acceptance acknowledgement lost'))
  await enter('Remote first request')
  ;(
    (await wait(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="Send message"]:not(:disabled)'),
    )) as HTMLButtonElement
  ).click()
  await wait(() => document.body.innerText.includes('Production host accepted.'))
  window.fetch = originalFetch
  if (
    retriedBodies.length !== 2 ||
    retriedBodies[0] !== retriedBodies[1] ||
    !JSON.parse(retriedBodies[0]).requestId
  )
    throw new Error('Remote retry changed the original admission')
  await wait(async () => {
    const conversations = await api(`/projects/${projectId}/conversations`)
    return conversations.find((conversation) => conversation.status === 'idle')
  })
  if (
    (await api('/bots/coder/conversations')).filter(
      (thread: { id: string }) => thread.id !== main.id,
    ).length !== 1
  )
    throw new Error('Remote retry created a duplicate conversation')
  await api(`/conversations/${id}/model`, { provider: 'test-provider', modelId: alternateModelId })
  await api(`/conversations/${id}/thinking`, { thinkingLevel: 'low' })
  await api(`/conversations/${id}/permission`, { permission: 'read-only' })
  const configured = await api(`/conversations/${id}`)
  if (
    configured.model.modelId !== alternateModelId ||
    configured.thinkingLevel !== 'low' ||
    configured.permission !== 'read-only' ||
    configured.contextUsage.contextWindow !== 65536
  )
    throw new Error('Remote model, thinking, permission or capacity was not preserved')
  await wait(() =>
    document
      .querySelector('[aria-label="Model and thinking level"]')
      ?.textContent?.includes('Alternate'),
  )
  await enter('approval-effect')
  ;(
    (await wait(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="Send message"]:not(:disabled)'),
    )) as HTMLButtonElement
  ).click()
  await wait(() => document.body.innerText.includes('Allow once'))
  await enter('Remote queued steer')
  await wait(() => document.querySelector<HTMLButtonElement>('[aria-label="Queue follow-up"]:not(:disabled)'))
  document.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, shiftKey: true, bubbles: true }))
  await wait(async () =>
    (await api(`/conversations/${id}`)).queue.some((item) => item.text === 'Remote queued steer' && item.steer),
  )
  const busy = await fetch(`/api/conversations/${id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'Busy conflict', mode: 'normal' }),
  })
  if (busy.status !== 409) throw new Error('Remote busy request was not a conflict')
  ;(
    (await wait(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="Stop Agent"]:not(:disabled)'),
    )) as HTMLButtonElement
  ).click()
  await wait(async () => {
    const snapshot = await api(`/conversations/${id}`)
    return snapshot.status === 'idle' && !snapshot.queue.length && !snapshot.approvals.length
  })
  const nextThread = await api('/bots/coder/conversations', {
    workspaceId: projectId,
    requestId: 'remote-second-thread',
  })
  await api('/conversations/' + nextThread.id + '/permission', { permission: 'read-only' })
  location.hash = '/bots/coder/conversations/' + nextThread.id
  await wait(
    () => document.querySelector('textarea') && document.body.innerText.includes('一起开始开发吧'),
  )
  await enter('approval-effect')
  ;(
    (await wait(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="Send message"]:not(:disabled)'),
    )) as HTMLButtonElement
  ).click()
  await wait(() => document.body.innerText.includes('Allow once'))
  ;(await button('Allow once')).click()
  await wait(() => document.body.innerText.includes('Production host accepted.'))
  const second = (await wait(async () => {
    const conversations = await api(`/projects/${projectId}/conversations`)
    return conversations.find(
      (conversation) => conversation.id === nextThread.id && conversation.status === 'idle',
    )
  })) as { id: string }
  const completed = await api(`/conversations/${second.id}`)
  if (
    !completed.activities.some(
      (activity) => activity.toolCallId === 'effect-call' && activity.status === 'completed',
    )
  )
    throw new Error('Completed remote tool activity disappeared')
  const publicState = JSON.stringify(completed).replace(/\\/g, '/')
  for (const secret of ['synthetic-key', '/sessions/', 'textSignature', 'thinkingSignature'])
    if (publicState.includes(secret)) throw new Error('Remote exposed private execution data')
  return {
    sent: true,
    queue: true,
    cancel: true,
    approval: true,
    configuration: true,
    threadId: second.id,
  }
}

export async function verifyRemoteMobile() {
  const wait = async (condition: () => unknown | Promise<unknown>) => {
    const until = Date.now() + 20000
    while (Date.now() < until) {
      const value = await condition()
      if (value) return value
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('Mobile condition timed out: ' + document.body.innerText.slice(0, 1200))
  }
  location.hash = '/bots/new'
  const name = (await wait(() =>
    document.querySelector<HTMLInputElement>('input[placeholder="例如：Nova"]'),
  )) as HTMLInputElement
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
    name,
    'Mobile Scout',
  )
  name.dispatchEvent(new Event('input', { bubbles: true }))
  const save = (await wait(() =>
    [...document.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].find(
      (button) => button.textContent?.trim() === '保存并开始对话',
    ),
  )) as HTMLButtonElement
  save.scrollIntoView()
  if (
    document.documentElement.scrollWidth > innerWidth ||
    save.getBoundingClientRect().right > innerWidth
  )
    throw new Error('Mobile Bot editor overflows the viewport')
  if (!document.querySelector('.bot-avatar svg'))
    throw new Error('Mobile avatar preview is missing')
  save.click()
  await wait(() => document.querySelector('textarea[placeholder*="Mobile Scout"]'))
  const bots = await (await fetch('/api/bots')).json()
  const bot = bots.find((bot: { name: string }) => bot.name === 'Mobile Scout')
  if (!bot || bot.isBuiltIn) throw new Error('Mobile Bot was not persisted')
  const main = await (await fetch('/api/bots/' + bot.id + '/main', { method: 'POST' })).json()
  if (!location.hash.endsWith('/' + main.id))
    throw new Error('Mobile creation did not open its main conversation')
  if (document.documentElement.scrollWidth > innerWidth)
    throw new Error('Mobile Chat overflows the viewport')
  return { created: true, main: main.id, botId: bot.id }
}
