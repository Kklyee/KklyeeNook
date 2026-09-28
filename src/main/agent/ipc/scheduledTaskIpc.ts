import { ipcMain } from 'electron'

import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  UpdateScheduledTaskInput,
} from '@/shared/scheduler/scheduledTask'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { AgentBackendProcess } from '../../agent-backend/process'

export function registerScheduledTaskIpc(backend: AgentBackendProcess): () => void {
  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASK_LIST, () =>
    backend.request<ScheduledTask[]>({ action: 'scheduled-task:list' }),
  )
  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASK_CREATE, (_event, input: CreateScheduledTaskInput) =>
    backend.request<ScheduledTask>({ action: 'scheduled-task:create', input }),
  )
  ipcMain.handle(
    IPC_CHANNELS.SCHEDULED_TASK_UPDATE,
    (_event, request: { id: string; input: UpdateScheduledTaskInput }) =>
      backend.request<ScheduledTask>({ action: 'scheduled-task:update', ...request }),
  )
  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASK_DELETE, (_event, id: string) =>
    backend.request<void>({ action: 'scheduled-task:delete', id }),
  )
  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASK_ENABLE, (_event, id: string) =>
    backend.request<ScheduledTask>({ action: 'scheduled-task:enable', id }),
  )
  ipcMain.handle(IPC_CHANNELS.SCHEDULED_TASK_DISABLE, (_event, id: string) =>
    backend.request<ScheduledTask>({ action: 'scheduled-task:disable', id }),
  )

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.SCHEDULED_TASK_LIST)
    ipcMain.removeHandler(IPC_CHANNELS.SCHEDULED_TASK_CREATE)
    ipcMain.removeHandler(IPC_CHANNELS.SCHEDULED_TASK_UPDATE)
    ipcMain.removeHandler(IPC_CHANNELS.SCHEDULED_TASK_DELETE)
    ipcMain.removeHandler(IPC_CHANNELS.SCHEDULED_TASK_ENABLE)
    ipcMain.removeHandler(IPC_CHANNELS.SCHEDULED_TASK_DISABLE)
  }
}
