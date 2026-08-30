import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import type { PetState } from '@/shared/pet/petState';
import { IPC_CHANNELS } from '@/shared/ipc/channels';

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

  async submitPrompt(prompt: string) {
    return await ipcRenderer.invoke(IPC_CHANNELS.AGENT_SUBMIT_PROMPT, prompt);
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
