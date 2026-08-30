import { useEffect, useState } from 'react';
import { PixiPetCanvas } from './pet/pet';
import type { PetState } from '@/shared/pet/petState';

function App(): React.JSX.Element {
  const [petState, setPetState] = useState<PetState>({ activity: 'idle' });
  const [prompt, setPrompt] = useState<string>('');
  const [response, setResponse] = useState<string>('');

  useEffect(() => {
    return window.api.onPetState((state) => {
      setPetState(state);
    });
  }, []);

  return (
    <main className="pet-demo">
      <section className="pet-card" aria-label="Robot pet preview">
        <div className="pet-canvas">
          <PixiPetCanvas activity={petState.activity} />
        </div>

        <div>
          <input type="text" onChange={(e) => setPrompt(e.target.value)} value={prompt} />
          <button
            onClick={async () => {
              const response = await window.api.submitPrompt(prompt);
              console.log(response);
              setPrompt('');
              setResponse(response);
            }}
          >
            Submit Prompt
          </button>
        </div>

        <div>{response}</div>
      </section>
    </main>
  );
}

export default App;
