import { BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '@/shared/ipc/channels';
import { PetState } from '@/shared/pet/petState';

export function sendPetState(window: BrowserWindow, state: PetState) {
  window.webContents.send(IPC_CHANNELS.PET_STATE_CHANGED, state);
}
