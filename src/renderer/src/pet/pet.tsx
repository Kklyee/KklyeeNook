import { useEffect, useRef, useState } from 'react';

import type { PetState } from '@/shared/pet/petState';

import { QuickInput } from '../chat/components/QuickInput';
import { PixiPetCanvas } from './PixiPetCanvas';

export function Pet() {
  const [petState, _] = useState<PetState>({ activity: 'idle' });
  const [inputOpen, setInputOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {}, []);

  /*
   * 点击 QuickInput 以外区域时关闭
   */
  useEffect(() => {
    if (!inputOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (bubbleRef.current?.contains(target)) {
        return;
      }
      if (rootRef.current?.contains(target)) {
        return;
      }
      setInputOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [inputOpen]);

  return (
    <div
      ref={rootRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'transparent',
      }}
    >
      {inputOpen && (
        <div
          ref={bubbleRef}
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '78%',
            transform: 'translateX(-50%)',
            zIndex: 10,
          }}
        >
          <QuickInput
            onClose={() => {
              setInputOpen(false);
            }}
          />
        </div>
      )}

      <div
        style={{ position: 'absolute', inset: 0, cursor: 'pointer' }}
        onClick={() => {
          setInputOpen(true);
        }}
      >
        <PixiPetCanvas activity={petState.activity} />
      </div>
    </div>
  );
}
