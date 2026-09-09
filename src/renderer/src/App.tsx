import { AssistantRuntime } from './chat/runtime/AssistantRuntimeProvider'
import { AppShell } from './app/AppShell'

function App(): React.JSX.Element {
  return (
    <main className="bg-background text-foreground h-full w-full">
      <AssistantRuntime>
        <AppShell />
      </AssistantRuntime>
    </main>
  )
}

export default App
