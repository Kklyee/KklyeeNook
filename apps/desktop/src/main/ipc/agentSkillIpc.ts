import { ipcMain } from 'electron'

import type { AgentSkill } from '@kklyeenook/shared/agent/agentSkill'
import { IPC_CHANNELS } from '@kklyeenook/shared/ipc/channels'
import type { AgentBackendProcess } from '../agent/process'

export function registerAgentSkillIpc(backend: AgentBackendProcess): () => void {
  ipcMain.handle(IPC_CHANNELS.AGENT_SKILLS_LIST, () =>
    backend.request<AgentSkill[]>({ action: 'skills:list' }),
  )
  ipcMain.handle(IPC_CHANNELS.AGENT_SKILLS_GET, (_event, id: string) =>
    backend.request<AgentSkill | null>({ action: 'skills:get', id }),
  )
  ipcMain.handle(IPC_CHANNELS.AGENT_SKILLS_RELOAD, () =>
    backend.request<AgentSkill[]>({ action: 'skills:reload' }),
  )

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_SKILLS_LIST)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_SKILLS_GET)
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_SKILLS_RELOAD)
  }
}
