export const IPC_CHANNELS = {
  SETTINGS_GET: 'settings:get',
  PET_STATE_CHANGED: 'pet:state-changed',
  AGENT_SUBMIT_PROMPT: 'agent:submit-prompt',
  WINDOW_GET_POSITION: 'window:get-position',
  WINDOW_SET_POSITION: 'window:set-position',
  AGENT_EVENT: 'agent:event',
  ASSISTANT_STREAM: 'assistant:stream',
  APPROVAL_REQUEST: 'approval:request',
  APPROVAL_RESPOND: 'approval:respond',
} as const
