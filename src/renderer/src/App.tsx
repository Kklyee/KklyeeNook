import { useEffect } from 'react';
import { AssistantRuntime } from './chat/runtime/AssistantRuntimeProvider';
import { ChatPanel } from './chat/components/ChatPannel';

function App(): React.JSX.Element {
  useEffect(() => {
    return window.api.onAgentEvent((event) => {
      console.log('[Agent Event]:', event);
    });
  }, []);
  return (
    <main className="pet-demo">
      <AssistantRuntime>
        <ChatPanel />
      </AssistantRuntime>
    </main>
  );
}

export default App;
