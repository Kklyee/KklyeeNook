import { AssistantRuntime } from '../features/chat/runtime/AssistantRuntimeProvider'
import { AppShell } from './AppShell'
import { useEffect } from 'react'
import { useWallpaper } from '../features/settings/useWallpaper'
import { watchSystemTheme } from '../features/settings/useTheme'

function App(): React.JSX.Element {
  useEffect(watchSystemTheme, [])
  const image = useWallpaper((state) => state.image)
  const loadWallpaper = useWallpaper((state) => state.load)
  useEffect(() => {
    void loadWallpaper()
  }, [loadWallpaper])
  useEffect(() => {
    document.documentElement.classList.toggle('has-wallpaper', image !== null)
    return () => document.documentElement.classList.remove('has-wallpaper')
  }, [image])
  useEffect(() => window.api.onSystemMaterialChanged((material) => {
    document.documentElement.classList.toggle('system-material-solid', material === 'solid')
    document.documentElement.classList.toggle('system-material', material !== 'solid')
  }), [])
  return (
    <main className="app-window material-base text-foreground h-full w-full">
      {image && (
        <div aria-hidden="true" className="window-wallpaper">
          <img src={image} alt="" className="window-wallpaper-image" />
        </div>
      )}
      <AssistantRuntime>
        <AppShell />
      </AssistantRuntime>
    </main>
  )
}

export default App
