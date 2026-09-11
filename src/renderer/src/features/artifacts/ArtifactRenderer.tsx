import { makeAssistantDataUI, type DataMessagePartComponent } from '@assistant-ui/react'
import { CheckIcon, ClipboardIcon, DownloadIcon, PlayIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { Artifact } from '@/shared/artifact/artifact'
import { artifactText } from '@/shared/artifact/artifact'
import { ArtifactCard } from './ArtifactCard'
import { CodeDiff, type DiffLine } from './CodeDiff'
import { DataTable } from './DataTable'
import { Button } from '@/renderer/src/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/src/components/ui/dialog'
import { codeScroll, codeSurface, mono } from '@/renderer/src/lib/surfaces'

function artifactMeta(artifact: Artifact): string {
  const label = artifact.kind[0]!.toUpperCase() + artifact.kind.slice(1)
  if (artifact.kind === 'table') return `${label} · ${artifact.rows.length} rows`
  return `${label} · ${artifactText(artifact).length.toLocaleString()} chars`
}

function diffLines(patch: string): DiffLine[] {
  return patch.split(/\r?\n/).map((line) => {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return { kind: 'added', text: line.slice(1) }
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      return { kind: 'removed', text: line.slice(1) }
    }
    return { kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line }
  })
}

function ArtifactBody({ artifact }: { artifact: Artifact }) {
  if (artifact.kind === 'diff') {
    const lines = diffLines(artifact.patch)
    return (
      <CodeDiff
        filename={artifact.filename ?? artifact.targetPath ?? artifact.title}
        additions={lines.filter(({ kind }) => kind === 'added').length}
        deletions={lines.filter(({ kind }) => kind === 'removed').length}
        lines={lines}
        cycle={0}
        className="max-w-none"
      />
    )
  }
  if (artifact.kind === 'table') {
    return <DataTable columns={artifact.columns} rows={artifact.rows} cycle={0} />
  }
  return (
    <div className={`${codeScroll} max-h-[60vh] rounded-xl border bg-muted/30`}>
      <pre className={`${codeSurface} p-4 text-[13px] leading-relaxed whitespace-pre-wrap`}>
        <code className={artifact.kind === 'markdown' ? '' : mono}>{artifact.content}</code>
      </pre>
    </div>
  )
}

type PiCustomMessageData = { customType?: string; details?: unknown }

function ArtifactMessage({ artifact }: { artifact: Artifact }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<'apply' | 'export' | null>(null)
  const [message, setMessage] = useState<string>()
  const canApply = artifact.kind !== 'table' && Boolean(artifact.targetPath)
  const text = useMemo(() => artifactText(artifact), [artifact])

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  const apply = async () => {
    if (!window.confirm(`Apply “${artifact.title}” to ${artifact.targetPath}?`)) return
    setBusy('apply')
    setMessage(undefined)
    try {
      const result = await window.api.applyArtifact({ artifactId: artifact.id })
      setMessage(result.path ? `Applied to ${result.path}` : 'Applied')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }
  const exportArtifact = async () => {
    setBusy('export')
    setMessage(undefined)
    try {
      const result = await window.api.exportArtifact({ artifactId: artifact.id })
      if (result.path) setMessage(`Exported to ${result.path}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="py-1">
      <ArtifactCard
        title={artifact.title}
        meta={artifactMeta(artifact)}
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-[min(900px,calc(100%-2rem))] overflow-hidden sm:max-w-[min(900px,calc(100%-2rem))]">
          <DialogHeader>
            <DialogTitle>{artifact.title}</DialogTitle>
            <DialogDescription>
              {artifactMeta(artifact)}
              {artifact.targetPath ? ` · ${artifact.targetPath}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto">
            <ArtifactBody artifact={artifact} />
          </div>
          {message && (
            <p className="text-muted-foreground text-xs" role="status">
              {message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => void copy()}>
              {copied ? <CheckIcon /> : <ClipboardIcon />} {copied ? 'Copied' : 'Copy'}
            </Button>
            {canApply && (
              <Button variant="outline" disabled={busy !== null} onClick={() => void apply()}>
                <PlayIcon />
                {busy === 'apply' ? 'Applying…' : 'Apply'}
              </Button>
            )}
            <Button disabled={busy !== null} onClick={() => void exportArtifact()}>
              <DownloadIcon />
              {busy === 'export' ? 'Exporting…' : 'Export'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const ArtifactRenderer: DataMessagePartComponent<PiCustomMessageData> = ({ data }) => {
  if (data.customType !== 'artifact') return null
  return <ArtifactMessage artifact={data.details as Artifact} />
}

export const ArtifactDataUI = makeAssistantDataUI<PiCustomMessageData>({
  name: 'pi-custom-message',
  render: ArtifactRenderer,
})
