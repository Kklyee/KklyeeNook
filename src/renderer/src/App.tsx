import { useEffect } from 'react';
import { Pet } from './pet/Pet';

function App(): React.JSX.Element {
  useEffect(() => {
    return window.api.onAgentEvent((event) => {
      console.log('[Agent Event]:', event);
    });
  }, []);
  return (
    <main className="pet-demo">
      <Pet />
    </main>
  );
}

export default App;
