import { IPC_CHANNELS } from '@/shared/ipc/channels';
import { ipcMain } from 'electron';

export function registerAgentIpc() {
  ipcMain.handle(IPC_CHANNELS.AGENT_SUBMIT_PROMPT, async (_event, prompt: string) => {
    console.log('user query:', prompt);
    return `user:${prompt} - response from agent`;
  });
}
