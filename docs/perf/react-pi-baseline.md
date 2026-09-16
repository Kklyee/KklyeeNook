# react-pi / Electron transport baseline

Date: 2026-09-16

## Installed versions

Versions read from the installed dependency tree (`npm ls ... --depth=0`):

| Package | Installed version |
| --- | --- |
| `@assistant-ui/react` | `0.15.17` |
| `@assistant-ui/react-pi` | `0.0.21` |
| `@assistant-ui/react-markdown` | `0.14.13` |
| `@assistant-ui/react-streamdown` | not installed |
| `electron` | `39.8.10` |

The runtime is the repository's custom `PiClientService`, not the package's
`createPiNodeClient`. It also owns app-specific settings, approval, context
attachments, artifacts, and run-history behavior; replacing it with the default
Node client would change those features.

## Current call chain

```text
Composer / Thread
 -> usePiRuntime: src/renderer/src/features/chat/runtime/AssistantRuntimeProvider.tsx
 -> electronPiClient: src/renderer/src/features/chat/runtime/electronPiClient.ts
 -> preload window.api.pi: src/preload/index.ts
 -> PI IPC handlers: src/main/agent/pi/client/piClientIpc.ts
 -> PiClientService: src/main/agent/pi/client/piClientService.ts
 -> PiSessionRuntimeManager / PiSessionRuntime: src/main/agent/pi/runtime/*
 -> Pi AgentSession event / PiClientEvent adapter
 -> PiClientService subscription relay
 -> Electron MessagePort (PI_THREAD_SUBSCRIBE)
 -> preload listener -> react-pi runtime -> assistant-ui Thread / Markdown
```

## Source-level transport observations

- Pi commands use `ipcRenderer.invoke`; the event subscription transfers a
  `MessagePort` with `ipcRenderer.postMessage`.
- `PiClientService.subscribe()` delivers a snapshot when subscribing (unless
  disabled), followed by sequence-numbered incremental `PiClientEvent`s.
- The inspected live-event path does not fetch and send a full thread snapshot
  for every Pi event. The subscription test also verifies that unsubscribing
  does not cancel the run.
- The Pi AgentSession and its event adaptation currently run in Electron main.
- These observations show that Pi events cross an Electron MessagePort, but do
  not establish that transport is the cause of renderer stalls.

## Performance measurements

No live-model prompt or Chromium/React profiler capture was run during this
static baseline. These values remain unmeasured and must not be treated as
zero:

| Metric | Before migration |
| --- | --- |
| Fixed 3–5 minute prompt / first-token time | Not measured |
| Renderer average / peak CPU | Not measured |
| Main-process CPU | Not measured |
| Agent-backend CPU | Not applicable; no separate backend process |
| Long Tasks over 50 ms / 200 ms | Not measured |
| React commits during streaming | Not measured |
| Input and scroll responsiveness | Not measured |
| First 30 seconds vs. final 30 seconds | Not measured |

Capturing comparable runtime numbers requires a running Electron build, a
configured model/provider, the same long prompt, and DevTools/React Profiler.
No API call was made for this baseline.

## Automated baseline checks

Before transport changes:

- `npm test`: 32 test files, 67 tests passed.
- `npm run typecheck`: node and web type checks passed.
- `npm run lint`: passed.
