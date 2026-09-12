const pendingContextAttachmentIds: string[] = []

/**
 * The Pi client contract only carries text and image parts. Keep the staged
 * text-file ids alongside the next composer send until the Electron client can
 * add them to its IPC request.
 */
export function rememberPendingContextAttachment(id: string): void {
  if (!pendingContextAttachmentIds.includes(id)) pendingContextAttachmentIds.push(id)
}

export function takePendingContextAttachmentIds(): string[] {
  return pendingContextAttachmentIds.splice(0, pendingContextAttachmentIds.length)
}

export function restorePendingContextAttachmentIds(ids: readonly string[]): void {
  const restored = ids.filter((id) => !pendingContextAttachmentIds.includes(id))
  pendingContextAttachmentIds.unshift(...restored)
}

export function forgetPendingContextAttachment(id: string): void {
  const index = pendingContextAttachmentIds.indexOf(id)
  if (index !== -1) pendingContextAttachmentIds.splice(index, 1)
}

export function clearPendingContextAttachmentIds(): void {
  pendingContextAttachmentIds.length = 0
}
