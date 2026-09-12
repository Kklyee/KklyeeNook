# Architecture

```text
┌─────────────────────────────────────────┐
│ Renderer                                │
│ React + assistant-ui Elements           │
│ AssistantRuntimeProvider                │
└───────────────────┬─────────────────────┘
                    │ window.api
┌───────────────────▼─────────────────────┐
│ Transport                               │
│ Preload + typed IPC + MessagePort       │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│ Main-process modules                    │
│ PiClientService · AgentService          │
│ ApprovalPolicy · ArtifactService        │
└───────────┬─────────────────┬───────────┘
            │                 │
┌───────────▼──────────┐  ┌───▼───────────┐
│ Pi runtime adapter  │  │ Persistence    │
│ PiSessionRuntime    │  │ SQLite         │
│ ModelRuntime        │  │ Pi JSONL       │
│ ToolRegistry        │  │ settings JSON  │
└─────────────────────┘  │ encrypted keys │
                         └───────────────┘
```

## Runtime ownership

- `AgentService` owns product sessions, AgentRun lifecycle, execution records, and runtime instances.
- `PiSessionRuntimeManager` owns the per-session runtime registry and runtime lifecycle.
- `PiSessionRuntime` owns one live Pi SDK session, its queue, model runtime, tools, extensions, and Pi event streams.
- `PiSessionRuntimePort` is the seam consumed by `PiAgentRuntime` and `PiClientService`; tests can provide a smaller adapter at this seam.
- `PiAgentRuntime` adapts one product AgentRun to the long-lived `PiSessionRuntime`; it maps Pi events to product `AgentEvent`s.
- `PiExtensionUiBridge` adapts Pi Extension UI calls (`confirm`, `select`, `input`, `editor`) to Renderer interactions.
- `PiClientService` adapts the renderer-facing Pi client interface and relays events; it does not create a second product Run for steering messages.
- A running Pi session runtime must always correspond to an active product Run. `AgentService.steerRun` enforces that invariant.

The `PiHostUiRequest` and `respondToHostUiRequest` names that remain in the
assistant-ui contract refer to the host application's UI surface. The local
module is named `PiExtensionUiBridge` because its concrete responsibility is to
bridge Pi Extension UI calls to the Renderer.

## Configuration and persistence

- Application settings are stored under Electron's `userData` directory.
- API keys are encrypted through Electron `safeStorage` before being written. If OS encryption is unavailable, credentials remain in memory for the current process only.
- Packaged database files live under `userData`; development keeps the existing project-local database path.
- The configured workspace is the shared filesystem root used by Pi tools, approval decisions, and Artifact application.
