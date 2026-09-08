import { AgentEvent } from '@/shared/agent/agentEvent'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import { ipcMain, BrowserWindow } from 'electron'
import { PetRuntime } from '../pet/petRuntime'
import { AgentService } from '../agent/agentService'

type Options = { agentService: AgentService; petRuntime: PetRuntime }

export function registerAgentIpc(_options: Options) {
  ipcMain.handle(IPC_CHANNELS.AGENT_SUBMIT_PROMPT, async (_event, prompt: string) => {
    console.log('Received prompt from renderer:', prompt)
    const window = BrowserWindow.fromWebContents(_event.sender)
    if (!window) {
      throw new Error('No window found for the event sender')
    }

    return { accepted: true }
  })
}

export function sendAgentEvent(window: BrowserWindow, event: AgentEvent) {
  window.webContents.send(IPC_CHANNELS.AGENT_EVENT, event)
}
