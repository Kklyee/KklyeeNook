import type { ReactNode } from 'react';

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const modelAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const lastMessage = messages.at(-1);

    const userText =
      lastMessage?.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('') ?? '';

    const response = `机器人收到你的任务了：${userText}`;

    let fullText = '';

    for (const char of response) {
      abortSignal.throwIfAborted();

      await sleep(40);

      fullText += char;

      yield { content: [{ type: 'text', text: fullText }] };
    }
  },
};

export function AssistantRuntime({ children }: { children: ReactNode }) {
  const runtime = useLocalRuntime(modelAdapter);

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
