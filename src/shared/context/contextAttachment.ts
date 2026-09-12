export interface ContextAttachmentRef {
  id: string
  name: string
  mimeType: string
  size: number
}

export interface StageContextAttachmentRequest {
  name: string
  mimeType: string
  size: number
  text: string
}

export interface RemoveContextAttachmentRequest {
  id: string
}
