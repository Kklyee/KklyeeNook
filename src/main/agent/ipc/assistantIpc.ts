import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'

import { ChatStreamControl, type ChatRequest, type ChatStreamEvent } from '@/shared/chat/chatEvent'

import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { AgentRunHandle } from '../agentService'
import { AgentService } from '../agentService'

interface Options {
  mainWindow: BrowserWindow
  agentService: AgentService
}

export function registerAssistantIpc({ mainWindow, agentService }: Options) {
  const handleStream = (event: IpcMainEvent, request: ChatRequest) => {
    let finished = false
    const [port] = event.ports
    if (!port) {
      return
    }

    if (event.sender !== mainWindow.webContents) {
      port.close()
      return
    }

    const abortController = new AbortController()

    port.once('close', () => {
      if (!finished) {
        abortController.abort()
      }
    })

    port.on('message', (event) => {
      const message = event.data as ChatStreamControl

      if (message.type === 'abort') {
        abortController.abort()
      }
    })
    port.start()

    const send = (message: ChatStreamEvent) => {
      port.postMessage(message)
    }

    const lastUserMessage = [...request.messages]
      .reverse()
      .find((message) => message.role === 'user')

    if (!lastUserMessage) {
      send({ type: 'error', message: '没有找到用户消息' })

      port.close()
      return
    }

    let handle: AgentRunHandle
    try {
      console.log('[assistantIpc] start run', { sessionId: request.sessionId })
      handle = agentService.startRun(
        request.sessionId,
        lastUserMessage.content,
        abortController.signal,
      )
    } catch (e) {
      finished = true

      send({ type: 'error', message: e instanceof Error ? e.message : String(e) })

      port.close()
      return
    }
    const unsubscribe = agentService.subscribe((envelope) => {
      if (envelope.sessionId !== request.sessionId || envelope.runId !== handle.run.id) {
        return
      }

      const agentEvent = envelope.event

      switch (agentEvent.type) {
        case 'user_message':
        case 'system_prompt':
        case 'approval_resolved':
          break

        case 'text_delta':
          send({ type: 'delta', text: agentEvent.text })
          break

        case 'tool_started':
          send({
            type: 'tool_start',
            toolCallId: agentEvent.call.id,
            toolName: agentEvent.call.toolName,
            args: agentEvent.call.args,
          })
          break

        case 'tool_updated':
          send({
            type: 'tool_update',
            toolCallId: agentEvent.toolCallId,
            partialResult: agentEvent.partialResult,
          })
          break

        case 'tool_finished':
          send({
            type: 'tool_end',
            toolCallId: agentEvent.result.toolCallId,
            result: agentEvent.result.output,
            success: agentEvent.result.success,
          })
          break

        case 'agent_completed':
          send({ type: 'done' })
          break

        case 'agent_aborted':
          send({ type: 'aborted' })
          break

        case 'agent_failed':
          send({ type: 'error', message: agentEvent.error })
          break
      }
    })

    void handle.completion.finally(() => {
      finished = true
      unsubscribe()
      try {
        port.close()
      } catch {}
    })
  }

  ipcMain.on(IPC_CHANNELS.ASSISTANT_STREAM, handleStream)

  mainWindow.once('closed', () => {
    ipcMain.removeListener(IPC_CHANNELS.ASSISTANT_STREAM, handleStream)
  })
}
