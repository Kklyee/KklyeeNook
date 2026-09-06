import { useEffect } from 'react';
import { AssistantRuntime } from './chat/runtime/AssistantRuntimeProvider';
import { ChatPanel } from './chat/components/ChatPannel';
import { Pet } from './pet/Pet';

function App(): React.JSX.Element {
  const windowType = new URLSearchParams(window.location.search).get('window');

  useEffect(() => {
    return window.api.onAgentEvent((event) => {
      console.log('[Agent Event]:', event);
    });
  }, []);

  if (windowType === 'pet') {
    return <Pet />;
  }

  return (
    <main className="flex flex-col  h-full bg-white">
      <AssistantRuntime>
        <ChatPanel />
      </AssistantRuntime>
    </main>
  );
}

export default App;
