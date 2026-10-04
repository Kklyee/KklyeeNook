import { create } from 'zustand'
import type { ThemeMode } from '@/shared/platform/theme'

const storageKey = 'kklyeenook-theme'
const savedTheme = localStorage.getItem(storageKey)
const initialTheme: ThemeMode = savedTheme === 'light' || savedTheme === 'system' ? savedTheme : 'dark'

function applyTheme(theme: ThemeMode): void {
  document.documentElement.classList.toggle('dark', window.api.window.setTheme(theme))
}

export const useTheme = create<{ theme: ThemeMode; setTheme: (theme: ThemeMode) => void }>((set) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    localStorage.setItem(storageKey, theme)
    applyTheme(theme)
    set({ theme })
  },
}))

export function initializeTheme(): void {
  applyTheme(useTheme.getState().theme)
}

export function watchSystemTheme(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const update = () => {
    if (useTheme.getState().theme === 'system') {
      document.documentElement.classList.toggle('dark', media.matches)
    }
  }
  media.addEventListener('change', update)
  return () => media.removeEventListener('change', update)
}
