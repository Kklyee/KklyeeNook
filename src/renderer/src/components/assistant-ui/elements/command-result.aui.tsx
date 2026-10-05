import { XIcon } from 'lucide-react'
import { Button } from '@/renderer/src/components/ui/button'
import type { CommandResult as Result } from '@/renderer/src/features/chat/commands/commandExecutor'

export function CommandResult({ result, onClose }: { result?: Result; onClose(): void }) {
  if (!result) return null
  return (
    <div role="status" className="material-raised rounded-2xl px-3.5 py-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{result.title}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="关闭命令结果"
          onClick={onClose}
        >
          <XIcon className="size-3.5 text-foreground/35" />
        </Button>
      </div>
      {result.message && <p className="text-foreground/60">{result.message}</p>}
      {result.rows && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5">
          {result.rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-foreground/45">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
