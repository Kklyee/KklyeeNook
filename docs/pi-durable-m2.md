# Pi Durable M2 进度

## 已完成：Prompt 与 Workspace 指令基础

`src/main/agent/agent-instructions.ts` 提供官方 Durable Extension/sections 与 AGENTS.md Loader；目前通过测试，尚未接入正式产品。M2 的 Tools/审批关卡未完成，不能声称 M2 已放行。

- Coding 与 Personal 为独立 `nook.coding` / `nook.personal` Extension。
- Identity 不复制仓库开发规范，不包含旧 Coding Agent 身份、SDK 本机路径或手写工具清单。
- Personal 不调用 Workspace Loader；无绑定 Workspace 的 Coding 不注入 AGENTS.md。
- 默认只读取绑定 Workspace；上层指令必须由 Host 显式提供授权的 `instructionRoot`，不能跨过授权根自动查找。
- 按授权祖先到目标目录顺序加载；保留每个文件的真实来源路径，子目录规则位于后面。
- targetDirectory 的词法路径和真实路径均需位于 Workspace，目录 junction/symlink 逃逸被拒绝。
- 缺失文件不报错；非文件、超限、非法 UTF-8、不可读取都返回诊断，不注入截断规则。
- 读取当前磁盘内容，按文件真实路径、mtime 和 size 缓存，可显式 invalidate，不创建全局 Watcher。
- Environment 只采用 Host 传入的实际环境描述；没有环境信息时不默认注入 Windows/PowerShell。
- sections 在模型请求前重新读取。测试证明文件更新影响后续请求，但已经提交的 system Entry 保持原内容。
- Workspace 文本不能修改 Agent 的工具或 Extension 选择；测试中的扩权文字不改变空工具允许列表。这不等于真实工具权限验收已完成。

## 验证

`src/main/agent/agent-instructions.test.ts` 六个核心测试通过：确定性来源/顺序、更新失效、缺失文件与新目标目录、超限与编码诊断、未授权祖先/目标/junction、身份隔离及两次真实 Durable 模型请求的历史一致性。

Node 类型检查与相关 oxlint 通过。测试使用官方 Faux Provider 和磁盘 SQLite，测试文件/数据库已清理。没有调用真实模型、用户凭据或用户 Workspace 的危险工具。

后续移除了 `thread-list-row.tsx` 中未使用的解构参数，保留 props 类型与所有显示行为。全仓 `pnpm run typecheck`、`pnpm run lint`、`pnpm run build` 现已通过，包括 Remote 和桌面构建。这只证明当前迁移分支可构建，不代表新执行器已接入产品或 M3–M5 已完成。

## 已完成：持久审批基础

`src/main/agent/durable-approvals.ts` 使用正式 `ToolTask` 的 `beforeTool` 与 `nook.approvals` Conversation Document。这里不是渲染端 Promise：请求和决定由 Durable 原子提交，等待只观察持久文档。工具仍停在官方 `call` checkpoint，批准后才由 SDK 写入 `execute` 意图。

- 稳定审批 ID 绑定 Conversation/Task，不使用工具名称或前端序号。
- 同一决定可幂等重试，矛盾决定、跨会话决定、已取消的待审批决定被拒绝。
- 原始参数、权限请求和说明保持绑定；恢复时权限请求变化不会消费旧批准。
- 关闭或崩溃不自动批准；恢复同一待审批请求。
- `AgentEngine.open` 的初始化回调在 `resume` 前执行，初始化失败释放 Harness/SQLite 所有权，避免恢复任务先于权限集成运行。
- 取消时依据 Durable Task 的终态/abort 标记过滤旧请求，不用业务数据库维护另一份执行状态。
- 真实 SIGKILL 测试覆盖等待中恢复和副作用发生后恢复：等待恢复批准后执行一次；`unsafe` 执行中崩溃不会再次执行，并产生官方 interrupted 结果。

`durable-approvals.test.ts` 八项测试及 `agent-engine.test.ts` 八项测试通过，Node 类型检查、全仓 lint 通过。批准还绑定工具名称与精确参数，后续 Hook 改写参数不能消费旧批准。生产 HTTP/UI 决策接口仍需接线。

## 已完成：工具权限桥接基础

`src/main/agent/durable-tools.ts` 将现有 ToolRegistry 的工具执行能力提供给 Durable，保留 ToolExecutionHarness、SandboxService、WorkspacePathPolicy 与结果保留策略。它不创建 Coding Agent Session，也没有旧 Agent/AgentRun 执行循环。

- beforeTool 使用真实 PermissionPolicy；MCP 和文件/命令的单次扩权都先持久审批。
- execute 阶段重新解析 Workspace/权限，审批回调只读取已提交批准，不在 unsafe checkpoint 后等待前端。
- 即使漏选审批 Extension，真实执行 Harness 仍拒绝需要批准的调用。
- 每个工具默认 unsafe；现阶段不声明任何工具可以安全重放。
- 保留 schema、结果状态/details、结果保留、输出与取消信号；执行完成或取消后清理 Sandbox 临时资源。
- Registry 动态注册的 MCP 工具可重建为同名 Durable Extension，仍走现有权限链路。

八项集成测试覆盖批准写入、工作区只读、工作区外拒绝、漏选 Guard 拒绝、恢复后的 Workspace 变化、命令进入 Sandbox 而非直接执行、MCP 单次批准与 metadata、取消、参数校验。相关七文件共 61 测试通过。

桥接暂时复用现有 `runtime: pi` 工具工厂，仅用于工具实现兼容，不能据此删除旧依赖。Sandbox 临时空间当前按工具 Task 隔离；跨工具的 Run 生命周期和调度/子任务归属需在 M4 统一。生产初始化与 Chat 尚未切换。

已执行现有 `pnpm run sandbox:setup`，UAC setup 返回成功。完整 Windows Sandbox 测试随后运行约 123 秒：30 通过、2 失败、1 原有环境跳过。Null 设备问题已解决；两个失败是 Python 解析到 WindowsApps 执行别名而无法在受限进程启动。符号链接测试仍因环境缺少 Developer Mode/SeCreateSymbolicLinkPrivilege 跳过。未修改测试过滤条件或安全策略，仍不能声称完整 Sandbox 验收通过。

## 待完成

- 真实 Provider、自定义模型/base URL、Thinking Level 与现有设置集成。
- 将已验证的 ToolRegistry/Sandbox/Workspace 和持久审批基础接到生产 HTTP/UI。
- 统一 Durable Run 的临时资源生命周期，并最终替换工具实现的旧依赖边界。
- Skills/ContextBuilder/MCP 的实际 Registry/sections 集成。
- 正式 Agent Backend 初始化顺序、restore 与 Hono 接线。

最新 `pnpm test --maxWorkers=2`：89 个文件中 88 通过，429 测试通过、30 失败、2 跳过，另有 1 个未处理拒绝。失败仍全部来自 Windows Sandbox Null 设备拒绝访问。

Windows Sandbox 的设备权限问题仍需通过项目现有管理员 setup 流程处理：`pnpm run sandbox:setup` 会调用已存在的 setup 脚本并请求 UAC 管理员批准。不能用 full-access、跳过安全测试或降低文件权限边界替代。
