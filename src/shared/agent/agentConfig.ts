export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export type ModelConfig = {
  modelID: string;
  provider: string;
  baseUrl?: string;
  thinkingLevel?: ThinkingLevel;
};

export type ToolConfig = { enabled: string[] };

export type AgentConfig = { model: ModelConfig; tools: ToolConfig; cwd?: string };
