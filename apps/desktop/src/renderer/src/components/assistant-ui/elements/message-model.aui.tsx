import { useAuiState } from '@assistant-ui/react'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/src/components/ui/popover'

const thinkingLabels: Record<ModelThinkingLevel, string> = {
  off: '关闭', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最大',
}

export function MessageModel() {
  const model = useAuiState((state) => state.message.metadata.custom?.durable as {
    provider?: string
    model?: string
    thinkingLevel?: ModelThinkingLevel
  } | undefined)
  if (!model?.model || model.provider === 'system') return null
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={200}
        closeDelay={150}
        aria-label="查看本轮模型信息"
        className="text-muted-foreground hover:text-foreground ms-2 max-w-48 truncate rounded-md px-1.5 py-1 text-[11px] transition-colors"
      >
        {model.model.split('/').at(-1)}
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-auto max-w-96 p-3" initialFocus={false}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Provider</dt>
          <dd className="break-all">{model.provider}</dd>
          <dt className="text-muted-foreground">模型</dt>
          <dd className="break-all">{model.model}</dd>
          <dt className="text-muted-foreground">思考等级</dt>
          <dd>{model.thinkingLevel ? thinkingLabels[model.thinkingLevel] : '未记录'}</dd>
        </dl>
      </PopoverContent>
    </Popover>
  )
}
