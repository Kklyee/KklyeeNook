import { PreviewHeader } from './PreviewHeader'
import { usePreview } from './PreviewProvider'
import { WorkspaceFilePreview } from './WorkspaceFilePreview'
import { CanvasSplitDocument } from '@/renderer/src/components/assistant-ui/elements/canvas-split'

export function PreviewPanel() {
  const { target } = usePreview()
  if (!target) return null
  return (
    <CanvasSplitDocument
      role="complementary"
      aria-label="预览面板"
      className="material-panel h-full overflow-hidden"
    >
      <PreviewHeader />
      <WorkspaceFilePreview key={target.path} target={target} />
    </CanvasSplitDocument>
  )
}
