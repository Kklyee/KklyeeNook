import { useEffect, useRef, useState } from 'react';

import type { PetState } from '@/shared/pet/petState';

import { QuickInput } from '../chat/components/QuickInput';
import { PixiPetCanvas } from './PixiPetCanvas';
import { usePetDrag } from './hooks/usePetDrag';

export function Pet() {
  const [petState, _] = useState<PetState>({ activity: 'idle' });
  const [inputOpen, setInputOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const petDrag = usePetDrag({
    onClick: () => {
      setInputOpen(true);
    },

    onDragStart: () => {
      setInputOpen(false);
    },
  });

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
        background: 'blue',
      }}
    >
      {inputOpen && (
        <div
          ref={bubbleRef}
          style={{
            position: 'absolute',
            left: '50%',
            top: 20,
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
        style={{ position: 'absolute', inset: 0, cursor: 'pointer', touchAction: 'none' }}
        onPointerDown={petDrag.onPointerDown}
        onPointerMove={petDrag.onPointerMove}
        onPointerUp={petDrag.onPointerUp}
        onPointerCancel={petDrag.onPointerCancel}
      >
        <PixiPetCanvas activity={petState.activity} />
      </div>
    </div>
  );
}
