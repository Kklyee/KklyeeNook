import type { ReactNode } from 'react';

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';

import type { ChatMessage } from '@/shared/chat/chatEvent';

const ipcChatModel: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    abortSignal.throwIfAborted();

    /*
     * assistant-ui Message
     * ↓
     * 我们自己的 ChatMessage
     */

    const serializedMessages: ChatMessage[] = [];

    for (const message of messages) {
      if (message.role !== 'user' && message.role !== 'assistant') {
        continue;
      }

      const text = message.content
        .flatMap((part) => {
          if (part.type === 'text') {
            return [part.text];
          }

          return [];
        })
        .join('\n');

      if (!text) continue;

      serializedMessages.push({ role: message.role, content: text });
    }

    /*
     * callback stream
     * ↓
     * 转成 ReadableStream
     */

    let stop: (() => void) | undefined;

    let removeAbortListener: (() => void) | undefined;

    const stream = new ReadableStream<string>({
      start(controller) {
        let settled = false;

        const close = () => {
          if (settled) return;

          settled = true;
          controller.close();
        };

        const fail = (error: unknown) => {
          if (settled) return;

          settled = true;
          controller.error(error);
        };

        stop = window.api.streamChat(
          { messages: serializedMessages },

          (event) => {
            switch (event.type) {
              case 'delta':
                controller.enqueue(event.text);
                break;

              case 'done':
                close();
                break;

              case 'error':
                fail(new Error(event.message));
                break;
            }
          },
        );

        const onAbort = () => {
          stop?.();

          fail(abortSignal.reason);
        };

        abortSignal.addEventListener('abort', onAbort, { once: true });

        removeAbortListener = () => {
          abortSignal.removeEventListener('abort', onAbort);
        };

        if (abortSignal.aborted) {
          onAbort();
        }
      },

      cancel() {
        stop?.();
      },
    });

    /*
     * assistant-ui 要求：
     *
     * yield 的不是 delta
     * 而是完整累计文本
     */

    const reader = stream.getReader();

    let fullText = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          return;
        }

        fullText += value;

        yield { content: [{ type: 'text', text: fullText }] };
      }
    } finally {
      removeAbortListener?.();
      stop?.();

      reader.releaseLock();
    }
  },
};

export function AssistantRuntime({ children }: { children: ReactNode }) {
  const runtime = useLocalRuntime(ipcChatModel);

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
