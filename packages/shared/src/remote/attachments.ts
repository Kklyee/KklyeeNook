export const TEXT_ATTACHMENT_ACCEPT = [
  'text/*',
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  '.txt',
  '.md',
  '.markdown',
  '.mdx',
  '.json',
  '.jsonl',
  '.csv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.css',
  '.scss',
  '.less',
  '.html',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.env',
  '.log',
  '.sql',
  '.sh',
  '.bash',
  '.bat',
  '.cmd',
  '.ps1',
  '.py',
  '.rb',
  '.php',
  '.java',
  '.kt',
  '.go',
  '.rs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.swift',
  '.graphql',
  '.gql',
  '.proto',
  '.diff',
  '.patch',
  '.lock',
  '.gitignore',
  '.gitattributes',
  '.dockerfile',
].join(',')

export const REMOTE_ATTACHMENT_LIMITS = { files: 8, textBytes: 512 * 1024, imageBytes: 5 * 1024 * 1024, totalBytes: 10 * 1024 * 1024 }
export const REMOTE_MESSAGE_MAX_BYTES = 16 * 1024 * 1024

export type RemoteFileAttachment = { name: string; mimeType: string; size: number } & (
  | { type: 'text'; text: string }
  | { type: 'image'; data: string }
)

export function acceptsTextAttachment(name: string, mimeType: string) {
  return TEXT_ATTACHMENT_ACCEPT.split(',').some(accept => accept.startsWith('.') ? name.toLowerCase().endsWith(accept) : accept.endsWith('/*') ? mimeType.startsWith(accept.slice(0, -1)) : accept === mimeType)
}
