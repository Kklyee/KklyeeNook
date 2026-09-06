import type { AgentEvent } from '@/shared/agent/agentEvent';

type Emit = (event: AgentEvent) => void;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runFakeAgent(prompt: string, emit: Emit, signal?: AbortSignal) {
  signal?.throwIfAborted();

  console.log('run agent');
  emit({ type: 'agent_started' });

  await sleep(500);

  emit({ type: 'text_delta', text: '我收到你的任务了。' });

  await sleep(500);

  emit({ type: 'text_delta', text: `你让我处理：${prompt}` });

  await sleep(700);

  emit({ type: 'tool_started', tool: 'read' });

  await sleep(1500);

  emit({ type: 'tool_finished', tool: 'read', success: true });

  await sleep(500);

  emit({ type: 'text_delta', text: '我已经检查完成。' });

  await sleep(500);

  emit({ type: 'agent_completed' });
}
