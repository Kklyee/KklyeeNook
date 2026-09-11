import { useState, type FormEvent } from 'react'
import { usePiRuntimeExtras, type PiHostUiRequest } from '@assistant-ui/react-pi'

import { Button } from '../../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'

function RequestDialog({
  request,
  respond,
}: {
  request: PiHostUiRequest
  respond: ReturnType<typeof usePiRuntimeExtras>['respondToHostUiRequest']
}) {
  const [value, setValue] = useState(request.kind === 'editor' ? (request.prefill ?? '') : '')
  const answer = (response: Parameters<typeof respond>[0]) => void respond(response)
  const submitValue = (event: FormEvent) => {
    event.preventDefault()
    answer({ requestId: request.id, value })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) answer({ requestId: request.id, dismissed: true })
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          {request.kind === 'confirm' && (
            <DialogDescription className="whitespace-pre-wrap">{request.message}</DialogDescription>
          )}
        </DialogHeader>

        {request.kind === 'select' && (
          <div className="flex flex-wrap gap-2">
            {request.options.map((option, index) => (
              <Button
                key={option}
                variant={index === 0 ? 'default' : 'outline'}
                onClick={() => answer({ requestId: request.id, value: option })}
              >
                {option}
              </Button>
            ))}
          </div>
        )}

        {(request.kind === 'input' || request.kind === 'editor') && (
          <form className="flex flex-col gap-3" onSubmit={submitValue}>
            {request.kind === 'input' ? (
              <Input
                autoFocus
                value={value}
                placeholder={request.placeholder}
                onChange={(event) => setValue(event.target.value)}
              />
            ) : (
              <textarea
                autoFocus
                className="border-input bg-background min-h-40 rounded-md border p-3 text-sm outline-none"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => answer({ requestId: request.id, dismissed: true })}
              >
                Cancel
              </Button>
              <Button type="submit">Submit</Button>
            </DialogFooter>
          </form>
        )}

        {request.kind === 'confirm' && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => answer({ requestId: request.id, confirmed: false })}
            >
              Deny
            </Button>
            <Button onClick={() => answer({ requestId: request.id, confirmed: true })}>
              Allow
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SelectRequestBar({
  request,
  respond,
}: {
  request: Extract<PiHostUiRequest, { kind: 'select' }>
  respond: ReturnType<typeof usePiRuntimeExtras>['respondToHostUiRequest']
}) {
  return (
    <div
      role="alertdialog"
      aria-label={request.title}
      className="bg-popover/95 border-border/80 absolute inset-x-4 bottom-36 z-50 mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border p-3 shadow-2xl backdrop-blur-md"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{request.title}</p>
        <p className="text-muted-foreground text-xs">请选择一个操作后继续</p>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {request.options.map((option, index) => (
          <Button
            key={option}
            size="sm"
            variant={index === 0 ? 'default' : 'outline'}
            onClick={() => void respond({ requestId: request.id, value: option })}
          >
            {option}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function PiHostUiPrompt() {
  const { allHostUiRequests: requests, respondToHostUiRequest } = usePiRuntimeExtras()
  const request = requests[0]

  if (!request) return null
  if (request.kind === 'select') {
    return (
      <SelectRequestBar
        key={request.id}
        request={request}
        respond={respondToHostUiRequest}
      />
    )
  }
  return <RequestDialog key={request.id} request={request} respond={respondToHostUiRequest} />
}
