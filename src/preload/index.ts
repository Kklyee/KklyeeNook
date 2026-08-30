import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import type { PetState } from '@/shared/pet/petState';
import { IPC_CHANNELS } from '@/shared/ipc/channels';
import { AgentEvent } from '@/shared/agent/agentEvent';

const api = {
  onPetState(callback: (state: PetState) => void) {
    const listener = (_event: IpcRendererEvent, state: PetState) => {
      callback(state);
    };
    ipcRenderer.on(IPC_CHANNELS.PET_STATE_CHANGED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.PET_STATE_CHANGED, listener);
    };
  },

  onAgentEvent(callback: (agentEvent: AgentEvent) => void) {
    const listener = (_event: IpcRendererEvent, agentEvent: AgentEvent) => {
      callback(agentEvent);
    };

    ipcRenderer.on(IPC_CHANNELS.AGENT_EVENT, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AGENT_EVENT, listener);
    };
  },

  async submitPrompt(prompt: string) {
    return await ipcRenderer.invoke(IPC_CHANNELS.AGENT_SUBMIT_PROMPT, prompt);
  },

  getWindowPosition() {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_GET_POSITION) as Promise<[number, number]>;
  },

  setWindowPosition(x: number, y: number) {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_SET_POSITION, x, y);
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}
