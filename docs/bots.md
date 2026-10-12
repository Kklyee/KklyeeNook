# Bot system

Personal Agent (小芽) and Coding Agent (Coder) are inserted once during Agent Host initialization. Coder uses the product-supplied coding prompt. Existing untouched defaults are upgraded; custom instructions remain unchanged.

Bot Profiles and Thread metadata live in the business database. Durable Conversations, Submissions, Tasks, approvals and messages remain in Pi Durable. Bot IDs, Thread IDs and Durable Conversation IDs are distinct. Each Bot has a stable, unique main Thread reference. Extra conversations belong to the Bot; coding conversations are grouped by authorized Workspace.

Each new admission captures identity, instructions, model, thinking level, tools, Workspace and permission ceiling. Running and queued Submissions retain captured configuration. Execution checks current Bot/tool/Workspace grants again before effects, including after approval. Coding Bots load applicable AGENTS.md; Personal Bots retain their identity when authorized to use a Workspace.

The registry adapter wraps the SDK GenerationTask prepare phase and keeps its task version, checkpoints and execution semantics. It applies the captured configuration before generation. Bot Profiles do not create additional agent processes.

Built-in Bots can be edited or reset. Custom deletion requires explicit archive-conversations confirmation and rejects live or queued work. It archives history and removes authorization without deleting project files. Main Threads cannot be archived or deleted individually. Scheduled tasks persist their Bot and reject a mismatched target Thread.

Desktop ChatStore starts and stops with React effects and can restart after StrictMode cleanup. Constructors used by React do not open connections. HTTP errors are visible in the Bot sidebar. Local and Remote share the Bot editor and local Boring Avatars SVG component. Bot accents do not alter message bubble colors. Avatar status comes from actual Durable work and pending approvals, with reduced motion support.

Remote retains authenticated HTTP/SSE and project endpoints. Creation accepts an explicit Bot; the Bot-first API handles main and extra conversations. Mobile verification uses a 390 × 844 viewport and covers profile creation, local SVG preview, viewport fit and opening the unique main conversation.

Windows continues to use the existing partial ACL sandbox. Bot file tools reject paths outside the current authorized Workspace, including full-access mode; Shell still uses the Workspace sandbox. The existing Windows sandbox does not provide complete isolation of arbitrary outside-file reads through Shell. This implementation does not claim stronger OS isolation.

Relevant verification includes Bot CRUD/default migration, unique main Thread creation, captured configuration across restart, immediate revocation, deletion versus admission, scheduled Bot dispatch, desktop development-mode StrictMode creation/chat/history, and actual Remote browser configuration/queue/cancellation/approval/mobile flows. Tests use isolated databases and synthetic model providers. They do not spend production provider credits.

Desktop acquires Electron single-instance ownership before bootstrapping the backend. A second launch focuses the existing window instead of opening its database and Chromium caches again. On this Windows machine, the Remote supervisor records development handover support in its status file. The pnpm dev launcher creates a live process lease, pauses the supervisor and stops only its recorded application process after verifying its executable path. On normal exit the launcher removes its own lease; a stale lease is ignored after the developer process exits. The supervisor then resumes background service. The integration test launches a second actual Electron process against the same profile and verifies that no duplicate backend starts.
