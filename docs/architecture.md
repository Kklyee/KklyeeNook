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
│ PiSessionHost       │  │ SQLite         │
│ ModelRuntime        │  │ Pi JSONL       │
│ ToolRegistry        │  │ settings JSON  │
└─────────────────────┘  │ encrypted keys │
                         └───────────────┘
```

## Runtime ownership

- `AgentService` owns product sessions, AgentRun lifecycle, execution records, and runtime instances.
- `PiSessionHost` owns the live Pi SDK session, its queue, model runtime, and Pi event stream.
- `PiClientService` adapts the renderer-facing Pi client interface and relays events; it does not create a second product Run for steering messages.
- A running Pi host must always correspond to an active product Run. `AgentService.steerRun` enforces that invariant.

## Configuration and persistence

- Application settings are stored under Electron's `userData` directory.
- API keys are encrypted through Electron `safeStorage` before being written. If OS encryption is unavailable, credentials remain in memory for the current process only.
- Packaged database files live under `userData`; development keeps the existing project-local database path.
- The configured workspace is the shared filesystem root used by Pi tools, approval decisions, and Artifact application.
