import { BrowserWindow } from 'electron';

import { AgentEvent } from '@/shared/agent/agentEvent';
import { PetRuntime } from '../pet/petRuntime';
import { sendAgentEvent } from '../ipc/agentIpc';

export function emitAgentEvent(window: BrowserWindow, petRuntime: PetRuntime, event: AgentEvent) {
  console.log('Emitting agent event:', event);
  petRuntime.dispatch(event);
  sendAgentEvent(window, event);
}
