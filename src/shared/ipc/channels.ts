export const IPC_CHANNELS = {
  PET_STATE_CHANGED: 'pet:state-changed',
  AGENT_SUBMIT_PROMPT: 'agent:submit-prompt',
  WINDOW_GET_POSITION: 'window:get-position',
  WINDOW_SET_POSITION: 'window:set-position',
  AGENT_EVENT: 'agent:event',
  ASSISTANT_STREAM: 'assistant:stream',
} as const;
