import { useEffect, useState } from 'react';

import { useSubmitPrompt } from '../hooks/useSubmitPrompt';

interface QuickInputProps {
  onClose: () => void;
}

export function QuickInput({ onClose }: QuickInputProps) {
  const [prompt, setPrompt] = useState('');

  const submitPrompt = useSubmitPrompt();

  const handleSubmit = async () => {
    const value = prompt.trim();
    if (!value || submitPrompt.isPending) {
      return;
    }

    try {
      await submitPrompt.mutateAsync(value);

      setPrompt('');
      onClose();
    } catch (error) {
      console.error('提交任务失败:', error);
    }
  };

  /*
   * Esc 关闭
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      style={{
        width: 320,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: 10,
        borderRadius: 14,
        background: 'rgba(255,255,255,0.96)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.16)',
      }}
      /*
       * 防止 Bubble 的点击继续冒泡到机器人
       */
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <input
        autoFocus
        value={prompt}
        placeholder="帮我做点什么..."
        disabled={submitPrompt.isPending}
        style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent' }}
        onChange={(event) => {
          setPrompt(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void handleSubmit();
          }
        }}
      />

      <button
        disabled={!prompt.trim() || submitPrompt.isPending}
        onClick={() => {
          void handleSubmit();
        }}
      >
        {submitPrompt.isPending ? '...' : '↑'}
      </button>
    </div>
  );
}
