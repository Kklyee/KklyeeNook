import { ImagePreview } from '@/renderer/src/components/assistant-ui/elements/image-preview'

export function ImageFilePreview({
  base64,
  mimeType,
  filename,
}: {
  base64: string
  mimeType: string
  filename: string
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      <ImagePreview
        src={`data:${mimeType};base64,${base64}`}
        alt={filename}
        containerClassName="h-full w-full flex items-center justify-center"
        className="max-h-full max-w-full object-contain"
      />
    </div>
  )
}
