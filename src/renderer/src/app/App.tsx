import { AssistantRuntime } from '../features/chat/runtime/AssistantRuntimeProvider'
import { AppShell } from './AppShell'
import { useEffect } from 'react'

function App(): React.JSX.Element {
  useEffect(() => window.api.onSystemMaterialChanged((material) => {
    document.documentElement.classList.toggle('system-material-solid', material === 'solid')
    document.documentElement.classList.toggle('system-material', material !== 'solid')
  }), [])
  return (
    <main className="material-base text-foreground h-full w-full">
      <AssistantRuntime>
        <AppShell />
      </AssistantRuntime>
    </main>
  )
}

export default App
