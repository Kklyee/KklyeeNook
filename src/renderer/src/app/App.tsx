import { AssistantRuntime } from '../features/chat/runtime/AssistantRuntimeProvider'
import { AppShell } from './AppShell'

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
