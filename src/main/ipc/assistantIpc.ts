import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'

import { type ChatRequest, type ChatStreamEvent } from '@/shared/chat/chatEvent'

import type { PetRuntime } from '@/main/pet/petRuntime'

import { emitAgentEvent } from '@/main/agent/agentEventDispatcher'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { PIAgentAdapter } from '../agent/PIAgentAdapter'

interface Options {
  mainWindow: BrowserWindow
  petRuntime: PetRuntime
  agent: PIAgentAdapter
}

export function registerAssistantIpc({ mainWindow, petRuntime, agent }: Options) {
  const handleStream = (event: IpcMainEvent, request: ChatRequest) => {
    const [port] = event.ports

    if (!port) {
      return
    }

    if (event.sender !== mainWindow.webContents) {
      port.close()
      return
    }

    port.start()
    const abortController = new AbortController()

    /*
     * assistant-ui Stop
     * ↓
     * preload 关闭 port
     * ↓
     * Main abort
     */

    port.once('close', () => {
      abortController.abort()
    })

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

    void agent.run(
      lastUserMessage.content,

      (agentEvent) => {
        // 驱动宠物 + 全局 AgentEvent
        emitAgentEvent(mainWindow, petRuntime, agentEvent)

        // 转换成 assistant-ui stream

        switch (agentEvent.type) {
          case 'text_delta':
            send({ type: 'delta', text: agentEvent.text })
            break

          case 'tool_started':
            send({
              type: 'tool_start',
              toolCallId: agentEvent.toolCallId,
              toolName: agentEvent.tool,
              args: agentEvent.args,
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
              toolCallId: agentEvent.toolCallId,
              result: agentEvent.result,
              success: agentEvent.success,
            })
            break

          case 'agent_completed':
            send({ type: 'done' })
            break
        }
      },

      abortController.signal,
    )
  }
  ipcMain.on(IPC_CHANNELS.ASSISTANT_STREAM, handleStream)

  mainWindow.once('closed', () => {
    ipcMain.removeListener(IPC_CHANNELS.ASSISTANT_STREAM, handleStream)
  })
}
