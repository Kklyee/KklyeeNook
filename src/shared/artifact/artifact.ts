export const ARTIFACT_KINDS = ['code', 'diff', 'table', 'markdown', 'file'] as const

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]
export type ArtifactCell = string | number | boolean | null
export type ArtifactMetadata = Record<string, string | number | boolean | null>

interface ArtifactDraftBase {
  title: string
  targetPath?: string
  metadata?: ArtifactMetadata
}

export interface CodeArtifactDraft extends ArtifactDraftBase {
  kind: 'code'
  content: string
  language?: string
  filename?: string
}

export interface DiffArtifactDraft extends ArtifactDraftBase {
  kind: 'diff'
  patch: string
  filename?: string
}

export interface TableArtifactDraft extends ArtifactDraftBase {
  kind: 'table'
  columns: string[]
  rows: ArtifactCell[][]
}

export interface MarkdownArtifactDraft extends ArtifactDraftBase {
  kind: 'markdown'
  content: string
  filename?: string
}

export interface FileArtifactDraft extends ArtifactDraftBase {
  kind: 'file'
  content: string
  filename: string
  mimeType?: string
}

export type ArtifactDraft =
  | CodeArtifactDraft
  | DiffArtifactDraft
  | TableArtifactDraft
  | MarkdownArtifactDraft
  | FileArtifactDraft

export type Artifact = ArtifactDraft & {
  id: string
  sessionId: string
  runId: string
  toolCallId?: string
  createdAt: number
}

export interface ListArtifactsRequest {
  sessionId: string
  runId?: string
}

export interface ApplyArtifactRequest {
  artifactId: string
}

export interface ExportArtifactRequest {
  artifactId: string
}

export interface ArtifactActionResult {
  path?: string
  canceled?: boolean
}

export function parseArtifactDraft(value: unknown): ArtifactDraft | undefined {
  if (
    !isRecord(value) ||
    typeof value.title !== 'string' ||
    !ARTIFACT_KINDS.includes(value.kind as ArtifactKind)
  ) {
    return undefined
  }
  const common =
    (value.targetPath === undefined || typeof value.targetPath === 'string') &&
    (value.metadata === undefined || isMetadata(value.metadata))
  if (!common) return undefined

  switch (value.kind) {
    case 'code':
      return typeof value.content === 'string' &&
        optionalString(value.language) &&
        optionalString(value.filename)
        ? (value as unknown as CodeArtifactDraft)
        : undefined
    case 'diff':
      return typeof value.patch === 'string' && optionalString(value.filename)
        ? (value as unknown as DiffArtifactDraft)
        : undefined
    case 'table':
      return Array.isArray(value.columns) &&
        value.columns.every((column) => typeof column === 'string') &&
        Array.isArray(value.rows) &&
        value.rows.every(
          (row) =>
            Array.isArray(row) &&
            row.every(
              (cell) => cell === null || ['string', 'number', 'boolean'].includes(typeof cell),
            ),
        )
        ? (value as unknown as TableArtifactDraft)
        : undefined
    case 'markdown':
      return typeof value.content === 'string' && optionalString(value.filename)
        ? (value as unknown as MarkdownArtifactDraft)
        : undefined
    case 'file':
      return typeof value.content === 'string' &&
        typeof value.filename === 'string' &&
        optionalString(value.mimeType)
        ? (value as unknown as FileArtifactDraft)
        : undefined
    default:
      return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isMetadata(value: unknown): value is ArtifactMetadata {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) => entry === null || ['string', 'number', 'boolean'].includes(typeof entry),
    )
  )
}

export function artifactText(artifact: ArtifactDraft): string {
  switch (artifact.kind) {
    case 'diff':
      return artifact.patch
    case 'table':
      return [artifact.columns, ...artifact.rows]
        .map((row) => row.map(csvCell).join(','))
        .join('\n')
    case 'code':
    case 'markdown':
    case 'file':
      return artifact.content
  }
}

function csvCell(value: ArtifactCell): string {
  const text = value === null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function artifactFilename(artifact: ArtifactDraft): string {
  if ('filename' in artifact && artifact.filename) return artifact.filename
  const invalidFilenameCharacters = '<>:"/\\|?*'
  const safeTitle =
    Array.from(artifact.title, (character) =>
      character.charCodeAt(0) < 32 || invalidFilenameCharacters.includes(character)
        ? '_'
        : character,
    )
      .join('')
      .trim() || 'artifact'
  const extension =
    artifact.kind === 'table' ? '.csv' : artifact.kind === 'diff' ? '.patch' : '.txt'
  return safeTitle.endsWith(extension) ? safeTitle : `${safeTitle}${extension}`
}
