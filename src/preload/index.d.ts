import type { ElectronAPI } from '@electron-toolkit/preload';
import type { PetState } from '@/shared/pet/petState';

interface API {
  onPetState(callback: (state: PetState) => void): () => void;
  submitPrompt(prompt: string): Promise<string>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: API;
  }
}
