import { useLayoutEffect, useRef, useState } from 'react'
import type { TextMessagePartComponent } from '@assistant-ui/react'
import { MessageMentionRenderer } from '@/renderer/src/features/chat/mentions/MessageMentionRenderer'
import { Button } from '@/renderer/src/components/ui/button'

export const UserMessageText: TextMessagePartComponent = (props) => {
  const content = useRef<HTMLDivElement>(null)
  const [long, setLong] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useLayoutEffect(() => {
    const element = content.current!
    const measure = () => setLong(element.scrollHeight > 256)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [props.text])
  return (
    <div>
      <div className={long && !expanded ? 'max-h-64 overflow-hidden' : undefined}>
        <div ref={content}><MessageMentionRenderer {...props} /></div>
      </div>
      {long && (
        <Button type="button" variant="ghost" size="xs" className="mt-1 px-0 text-xs" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起' : '展开全文'}
        </Button>
      )}
    </div>
  )
}
