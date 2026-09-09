# Project architecture

KklyeeNook is an Electron application with a React renderer and an agent runtime backed by Pi.

## Source layout

```text
src/
├── main/       Electron main process and application modules
├── preload/    The safe interface exposed to the renderer
├── renderer/   React application
└── shared/     Process-neutral contracts and IPC channel names
```

The top-level folders follow Electron's runtime model. Inside each runtime, code is grouped by
product capability so that a change stays local to one module.

## Main process

```text
main/
├── index.ts           Electron lifecycle entry point
├── app/               Composition and renderer loading
├── agent/             Sessions, runs, streaming, and runtime seam
│   ├── ipc/           Agent-facing IPC handlers
│   └── pi/            Pi SDK implementation
├── approval/          Tool approval policy and workflow
├── settings/          Agent configuration and credentials
├── tools/             Built-in tool selection
└── electron/          BrowserWindow and window-specific IPC
```

`main/index.ts` only owns Electron lifecycle. `app/bootstrap.ts` is the composition root where
concrete implementations are created and connected.

The Agent module exposes `AgentService` to callers. Pi-specific types and behavior stay under
`agent/pi`; they must not be imported by the preload or renderer.

Feature IPC handlers live with the module they expose. Electron-only behavior that is not a
product feature lives under `main/electron`.

## Renderer

```text
renderer/src/
├── main.tsx
├── app/               Application shell and global styles
├── features/          Product capabilities
│   ├── chat/
│   ├── approval/
│   └── settings/
├── components/        Reusable and generated UI building blocks
├── hooks/             Hooks shared by multiple features
└── lib/               Framework-independent renderer helpers
```

Feature-specific UI, hooks, adapters, and runtime integration stay in their feature directory.
Only code reused by multiple features belongs in `components`, `hooks`, or `lib`.

`components/ui` and `components/assistant-ui` contain UI building blocks managed through the
component registry configured in `components.json`. Product-specific compositions should not be
added there.

## Dependency direction

```text
renderer ──> preload interface ──> main modules
    │                                │
    └──────────> shared <────────────┘

main/agent/pi ──> Pi SDK
```

Keep these rules:

- `shared` must not import from `main`, `preload`, or `renderer`.
- `renderer` must not import Electron or Pi SDK types directly.
- `preload` translates IPC into the small `window.api` interface used by the renderer.
- Pi events are converted to application-owned events before leaving `main/agent/pi`.
- A feature should depend on another feature only through an intentional interface.

## Adding code

- Add behavior to an existing feature before creating a new top-level directory.
- Create a subdirectory only when it groups multiple related files.
- Co-locate feature tests with the implementation they verify.
- Avoid empty placeholder files and speculative interfaces.
- Keep generated UI building blocks separate from product-specific compositions.
