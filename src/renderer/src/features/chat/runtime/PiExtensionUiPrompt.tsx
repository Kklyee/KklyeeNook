import { useState, type FormEvent } from 'react'
import {
  usePiRuntimeExtras,
  type PiHostUiRequest as PiExtensionUiRequest,
} from '@assistant-ui/react-pi'

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
import { Textarea } from '../../../components/ui/textarea'

function RequestDialog({
  request,
  respond,
}: {
    request: PiExtensionUiRequest
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
              <Textarea
                autoFocus
                className="min-h-40 p-3 text-sm"
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
  request: Extract<PiExtensionUiRequest, { kind: 'select' }>
  respond: ReturnType<typeof usePiRuntimeExtras>['respondToHostUiRequest']
}) {
  return (
    <div
      role="alertdialog"
      aria-label={request.title}
      className="popover-glass animate-in slide-in-from-bottom-2 fade-in relative z-10 mx-auto grid w-full max-w-(--thread-max-width) grid-cols-1 items-center gap-3 rounded-2xl p-3 duration-200 motion-reduce:animate-none sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <p className="min-w-0 break-words text-sm leading-relaxed font-medium">{request.title}</p>
      <div className="flex flex-wrap justify-end gap-2">
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

export function PiExtensionUiPrompt() {
  const {
    allHostUiRequests: requests,
    respondToHostUiRequest: respondToExtensionUiRequest,
  } = usePiRuntimeExtras()
  const request = requests[0]

  if (!request) return null
  if (request.kind === 'select') {
    return (
      <SelectRequestBar
        key={request.id}
        request={request}
        respond={respondToExtensionUiRequest}
      />
    )
  }
  return <RequestDialog key={request.id} request={request} respond={respondToExtensionUiRequest} />
}
