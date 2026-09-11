import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import type { PiHostUiRequest, PiHostUiResponse } from '@assistant-ui/react-pi/node'

type DialogOptions = { signal?: AbortSignal; timeout?: number } | undefined
type PendingRequest = {
  request: PiHostUiRequest
  settle(response: PiHostUiResponse): void
  dismiss(): void
}

interface Options {
  nextRequestId(): string
  currentToolCallId(): string | undefined
  onRequest(request: PiHostUiRequest): void
  onResolved(requestId: string): void
}

export interface PiHostUiBridge {
  ui: ExtensionUIContext
  pending(): PiHostUiRequest[]
  respond(response: PiHostUiResponse): boolean
  dispose(): void
}

export function createPiHostUiBridge(options: Options): PiHostUiBridge {
  const pending = new Map<string, PendingRequest>()

  const ask = <T>(
    request: PiHostUiRequest,
    convert: (response: PiHostUiResponse) => T,
    dismissed: T,
    dialogOptions?: DialogOptions,
  ) =>
    new Promise<T>((resolve) => {
      let complete = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (value: T) => {
        if (complete) return
        complete = true
        pending.delete(request.id)
        if (timer) clearTimeout(timer)
        dialogOptions?.signal?.removeEventListener('abort', onAbort)
        options.onResolved(request.id)
        resolve(value)
      }
      const onAbort = () => finish(dismissed)

      pending.set(request.id, {
        request,
        settle: (response) => finish(convert(response)),
        dismiss: onAbort,
      })
      if (dialogOptions?.signal?.aborted) {
        finish(dismissed)
        return
      }
      dialogOptions?.signal?.addEventListener('abort', onAbort, { once: true })
      if (dialogOptions?.timeout && dialogOptions.timeout > 0) {
        timer = setTimeout(onAbort, dialogOptions.timeout)
      }
      options.onRequest(request)
    })

  const correlation = (dialogOptions?: DialogOptions) => {
    const toolCallId = options.currentToolCallId()
    return {
      ...(toolCallId ? { toolCallId } : {}),
      ...(dialogOptions?.timeout ? { timeoutMs: dialogOptions.timeout } : {}),
    }
  }

  const ui: ExtensionUIContext = {
    confirm: (title, message, dialogOptions) =>
      ask(
        {
          id: options.nextRequestId(),
          kind: 'confirm',
          title,
          message,
          ...correlation(dialogOptions),
        },
        (response) => ('confirmed' in response ? response.confirmed : false),
        false,
        dialogOptions,
      ),
    select: (title, values, dialogOptions) =>
      ask(
        {
          id: options.nextRequestId(),
          kind: 'select',
          title,
          options: values,
          ...correlation(dialogOptions),
        },
        (response) => ('value' in response ? response.value : undefined),
        undefined,
        dialogOptions,
      ),
    input: (title, placeholder, dialogOptions) =>
      ask(
        {
          id: options.nextRequestId(),
          kind: 'input',
          title,
          ...(placeholder !== undefined ? { placeholder } : {}),
          ...correlation(dialogOptions),
        },
        (response) => ('value' in response ? response.value : undefined),
        undefined,
        dialogOptions,
      ),
    editor: (title, prefill) =>
      ask(
        {
          id: options.nextRequestId(),
          kind: 'editor',
          title,
          ...(prefill !== undefined ? { prefill } : {}),
          ...correlation(),
        },
        (response) => ('value' in response ? response.value : undefined),
        undefined,
      ),
    notify: () => {},
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => '',
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
    custom: () => Promise.reject(new Error('Custom Pi terminal UI is unavailable in Electron')),
    get theme() {
      return {} as ExtensionUIContext['theme']
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'Pi terminal themes are unavailable in Electron' }),
  }

  return {
    ui,
    pending: () => [...pending.values()].map(({ request }) => request),
    respond(response) {
      const request = pending.get(response.requestId)
      if (!request) return false
      request.settle(response)
      return true
    },
    dispose() {
      for (const request of pending.values()) request.dismiss()
    },
  }
}
