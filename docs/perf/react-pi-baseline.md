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

The runtime keeps the repository's custom `PiClientService` as the app facade
for settings, approval, context attachments, artifacts, and run-history
behavior. The backend now also owns one long-lived package
`createPiNodeClient()` instance through an adapter; it is not recreated per
request.

## Current call chain

```text
Composer / Thread
 -> usePiRuntime: src/renderer/src/features/chat/runtime/AssistantRuntimeProvider.tsx
 -> electronPiClient: src/renderer/src/features/chat/runtime/electronPiClient.ts
 -> preload window.api.pi: src/preload/index.ts
 -> PI IPC handlers: src/main/agent/pi/client/piClientIpc.ts
 -> PiClientService: src/main/agent/pi/client/piClientService.ts
 -> PiNodeClientAdapter: src/main/agent-backend/piNodeClientAdapter.ts
 -> PiSessionRuntimeManager / PiSessionRuntime: src/main/agent/pi/runtime/*
 -> Pi AgentSession event / PiClientEvent adapter
 -> PiClientService subscription relay
 -> Electron MessagePort (PI_THREAD_SUBSCRIBE)
 -> preload listener -> react-pi runtime -> assistant-ui Thread / Markdown
```

## Before-migration source-level transport observations

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

## Migration implementation status

- `PI_TRANSPORT=http` (default) uses a memoized `createPiHttpClient` over local
  HTTP/SSE and runs the existing Pi service in an Electron utility process.
- `createPiNodeClient()` is created once during backend initialization by
  `src/main/agent-backend/piNodeClientAdapter.ts`. The adapter keeps the custom
  app facade for featureful operations and uses the NodeClient model catalog as
  a fallback when the app catalog is empty.
- In installed `@assistant-ui/react-pi` 0.0.21 source, `PiNodeClientOptions`
  exposes only `workspacePath`, `agentDir`, and `model`; it has no direct
  injection point for the app's custom runtime, credentials, tools, or approval
  services, so it remains an unsafe drop-in replacement. The adapter is the
  compatibility boundary until those app-owned features are migrated.
- `PI_TRANSPORT=ipc` keeps the previous Pi IPC/MessagePort route available for
  same-UI A/B runs. Both options use the same utility-process Pi service, so
  this compares transport paths, not the old main-process placement.
- The IPC path remains until a comparable live run and profiler capture have
  been reviewed; it has not been removed based on unmeasured results.
- Static/unit checks cover the long-lived NodeClient adapter, HTTP/SSE routes,
  continuous SSE events, latest
  authoritative snapshot on reconnect, disconnect without cancel/restart,
  utility-process lifetime across renderer-window recreation, shutdown and
  crash-status forwarding, renderer attachment transport, and CSP. No live
  model prompt or CPU/React Profiler capture was run during implementation.
- Verification: `npm test` passed (38 files / 83 tests); typecheck, lint, and
  `npm run build` passed. `electron-builder --dir --publish never` completed,
  and the packaged `app.asar` contains the main, utility backend, preload,
  renderer, and main-process chunk files. A dev-mode smoke test rendered the
  chat UI using the default HTTP transport. An earlier launch attempt against
  the existing unpacked package did not expose a window; its cause was not
  isolated. After a fresh build and package, `dist/win-unpacked/kklyeenook.exe`
  launched successfully twice. In the final-package smoke test, the chat
  composer was present, `%APPDATA%\kklyeenook\data` was created, a
  `127.0.0.1` listener was owned by the app process group, and `GET /health`
  returned `{ ok: true, service: "kklyeenook-agent-backend" }`. No model prompt
  was sent. Package runtime startup and local HTTP health checks pass; live
  model performance and profiler checks remain outstanding. A separate final-
  package launch with `PI_TRANSPORT=ipc` also reached the chat composer without
  an unavailable-backend state; this is a startup smoke check only, not evidence
  of functional or performance parity.

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
