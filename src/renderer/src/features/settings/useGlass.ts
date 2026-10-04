import { create } from 'zustand'

const storageKey = 'kklyeenook-glass'

function applyGlass(enabled: boolean): void {
  const root = document.documentElement
  root.classList.toggle('glass-disabled', !enabled)
  const material = window.api.window.setMaterialEnabled(enabled)
  root.classList.toggle('system-material', material !== 'solid')
  root.classList.toggle('system-material-solid', material === 'solid')
}

export const useGlass = create<{ enabled: boolean; setEnabled: (enabled: boolean) => void }>((set) => ({
  enabled: localStorage.getItem(storageKey) !== 'false',
  setEnabled: (enabled) => {
    localStorage.setItem(storageKey, String(enabled))
    applyGlass(enabled)
    set({ enabled })
  },
}))

export function initializeGlass(): void {
  applyGlass(useGlass.getState().enabled)
}
