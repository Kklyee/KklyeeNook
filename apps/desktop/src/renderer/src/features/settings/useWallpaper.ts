import { create } from 'zustand'

export const useWallpaper = create<{
  image: string | null
  loading: boolean
  error: string | null
  load: () => Promise<void>
  choose: () => Promise<void>
  clear: () => Promise<void>
}>((set) => {
  const update = async (action: () => Promise<string | null>) => {
    set({ loading: true, error: null })
    try {
      set({ image: await action() })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '无法更新壁纸，请重试。' })
    } finally {
      set({ loading: false })
    }
  }
  return {
    image: null,
    loading: false,
    error: null,
    load: () => update(window.api.wallpaper.get),
    choose: () => update(window.api.wallpaper.choose),
    clear: () => update(window.api.wallpaper.clear),
  }
})
