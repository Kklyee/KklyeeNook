import { useState, type FormEvent } from 'react'
import { usePiHostUiRequests, type PiHostUiRequest } from '@assistant-ui/react-pi'

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
  respond: ReturnType<typeof usePiHostUiRequests>['respond']
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
              <Button type="button" variant="outline" onClick={() => answer({ requestId: request.id, dismissed: true })}>
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
            <Button onClick={() => answer({ requestId: request.id, confirmed: true })}>Allow</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function PiHostUiPrompt() {
  const { requests, respond } = usePiHostUiRequests()
  const request = requests[0]

  return request ? <RequestDialog key={request.id} request={request} respond={respond} /> : null
}
