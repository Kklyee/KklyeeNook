import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { PetState } from '@/shared/pet/petState'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import { AgentEvent } from '@/shared/agent/agentEvent'
import { ChatRequest, ChatStreamEvent } from '@/shared/chat/chatEvent'
import { ApprovalRequest, ApprovalResponse } from '@/shared/approval/approvalTypes'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import {
  AgentSessionSummary,
  CreateAgentSessionRequest,
  DeleteAgentSessionRequest,
  RenameAgentSessionRequest,
} from '@/shared/agent/agentSession'

const api = {
  getAgentSettings(): Promise<AgentSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET)
  },

  onPetState(callback: (state: PetState) => void) {
    const listener = (_event: IpcRendererEvent, state: PetState) => {
      callback(state)
    }
    ipcRenderer.on(IPC_CHANNELS.PET_STATE_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.PET_STATE_CHANGED, listener)
    }
  },

  onAgentEvent(callback: (agentEvent: AgentEvent) => void) {
    const listener = (_event: IpcRendererEvent, agentEvent: AgentEvent) => {
      callback(agentEvent)
    }

    ipcRenderer.on(IPC_CHANNELS.AGENT_EVENT, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AGENT_EVENT, listener)
    }
  },

  async submitPrompt(prompt: string) {
    return await ipcRenderer.invoke(IPC_CHANNELS.AGENT_SUBMIT_PROMPT, prompt)
  },

  getWindowPosition() {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_GET_POSITION) as Promise<[number, number]>
  },

  setWindowPosition(x: number, y: number) {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_SET_POSITION, x, y)
  },

  streamChat(request: ChatRequest, onEvent: (event: ChatStreamEvent) => void) {
    const { port1, port2 } = new MessageChannel()

    const handleMessage = (event: MessageEvent<ChatStreamEvent>) => {
      onEvent(event.data)
    }
    port1.addEventListener('message', handleMessage)
    port1.start()
    ipcRenderer.postMessage(IPC_CHANNELS.ASSISTANT_STREAM, request, [port2])

    let stopped = false

    return () => {
      if (stopped) return
      stopped = true
      port1.removeEventListener('message', handleMessage)
      port1.close()
    }
  },

  onApprovalRequested(callback: (request: ApprovalRequest) => void) {
    const listener = (_event: IpcRendererEvent, request: ApprovalRequest) => {
      callback(request)
    }

    ipcRenderer.on(IPC_CHANNELS.APPROVAL_REQUEST, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.APPROVAL_REQUEST, listener)
    }
  },

  respondApproval(response: ApprovalResponse) {
    ipcRenderer.send(IPC_CHANNELS.APPROVAL_RESPOND, response)
  },

  createAgentSession(request: CreateAgentSessionRequest): Promise<AgentSessionSummary> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_CREATE, request)
  },

  listAgentSessions(): Promise<AgentSessionSummary[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_LIST)
  },

  renameAgentSession(request: RenameAgentSessionRequest): Promise<AgentSessionSummary> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_RENAME, request)
  },

  deleteAgentSession(request: DeleteAgentSessionRequest): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_DELETE, request)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
