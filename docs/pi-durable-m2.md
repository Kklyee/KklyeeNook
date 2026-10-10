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

## 待完成

- 真实 Provider、自定义模型/base URL、Thinking Level 与现有设置集成。
- 现有 ToolRegistry/Sandbox/Workspace 工具适配，不能绕过 ToolExecutionHarness。
- beforeTool 准备阶段的持久审批暂停、允许/拒绝、重启恢复和工具危险副作用测试。
- Skills/ContextBuilder/MCP 的实际 Registry/sections 集成。
- 正式 Agent Backend 初始化顺序、restore 与 Hono 接线。

最新 `pnpm test --maxWorkers=2`：89 个文件中 88 通过，429 测试通过、30 失败、2 跳过，另有 1 个未处理拒绝。失败仍全部来自 Windows Sandbox Null 设备拒绝访问。

Windows Sandbox 的设备权限问题仍需通过项目现有管理员 setup 流程处理：`pnpm run sandbox:setup` 会调用已存在的 setup 脚本并请求 UAC 管理员批准。不能用 full-access、跳过安全测试或降低文件权限边界替代。
