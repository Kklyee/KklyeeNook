export interface PreviewWorkspaceFileRequest {
  sessionId: string
  path: string
}

interface WorkspaceFileInfo {
  path: string
  filename: string
  size: number
}

export type WorkspaceFilePreview =
  | (WorkspaceFileInfo & { kind: 'text'; mimeType: string; content: string })
  | (WorkspaceFileInfo & { kind: 'image'; mimeType: string; base64: string })
  | (WorkspaceFileInfo & { kind: 'unsupported'; mimeType?: string; reason: 'format' | 'too-large' })
  | { kind: 'missing'; path: string; filename: string }
