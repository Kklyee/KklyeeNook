import { useEffect } from 'react'
import { AssistantRuntime } from './chat/runtime/AssistantRuntimeProvider'
import { AppShell } from './app/AppShell'
import { Pet } from './pet/Pet'

function App(): React.JSX.Element {
  const windowType = new URLSearchParams(window.location.search).get('window')

  useEffect(() => {
    return window.api.onAgentEvent((event) => {
      console.log('[Agent Event]:', event)
    })
  }, [])

  if (windowType === 'pet') {
    return <Pet />
  }

  return (
    <main className="bg-background text-foreground h-full w-full">
      <AssistantRuntime>
        <AppShell />
      </AssistantRuntime>
    </main>
  )
}

export default App
