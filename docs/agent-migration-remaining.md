# Agent 迁移：当前范围与验收

## 范围

2026-10-11 用户明确调整要求：以前的会话数据可以舍弃，不做旧数据兼容；根据最新 Pi Durable 的数据结构修改后端和 Agent，保持现有 UI 渲染，代码必须干净、简洁、易读。随后要求把桌面放入 apps/desktop，并允许独立整理 Agent/Server；当前采用 apps/desktop 与 apps/agent，共享协议留在 packages/shared。

此要求优先于初始 goal 文件及 M0–M4 文档中的历史兼容、旧 JSONL 读取、历史续接和旧数据恢复要求。旧里程碑文档仅保留过程记录，不再作为继续实现兼容层的依据。

当前分支为 `feat/pi-durable-migration`，已推送至 `29f5e85`。npm 的最新 `@earendil-works/pi-durable` 为 `1.1.0`，项目已使用该版本；已核对官方 README、SDK 类型及 Context7 `/earendil-works/pi` 文档。

## 设计约束

- Pi Durable 的 Conversation、Task、Submission、Entry、LiveDoc、InboxDoc 和 watchEvents 是执行、队列、取消、重试与恢复的唯一权威。
- Drizzle 只保存 Workspace、设置、Memory、调度定义等业务数据及必要的会话业务信息；不建立第二套执行状态。
- 保持现有消息、思考、工具、图片、Markdown、活动与任务面板的渲染组件和样式。只保留 SDK 数据到 UI 的必要投影。
- 删除旧执行器、旧协议、历史兼容、无使用者的适配器与依赖，不保留双路径或旧数据回退。
- 保留认证、Origin、请求大小、Workspace、Sandbox、审批、工具结果保留和取消边界。
- 不添加代码注释，不引入没有实际用途的抽象、配置项或防御分支。

## 已完成实现

1. 已移除旧会话读取、冻结历史、续接入口、历史标记和旧 Run/Trace 回退，只列出 SDK 管理的会话。
2. 已删除旧 Agent/Pi runtime/client、旧调度器和旧 HTTP 协议；复用工具集中到 tools，SDK 工具与安全验证保留。桌面、Agent 和公共协议分别位于 apps/desktop、apps/agent 与 packages/shared；Gateway 和本地服务随 Agent 生命周期管理，不拆出重复的 Server 宿主。
3. 已移除 pi-coding-agent、pi-agent-core、pi-ai-legacy、react-pi 及其 override/补丁，更新 lockfile；执行存储改为 agent.sqlite，旧执行表迁移删除。
4. 定时输入的来源保存在 SDK inputDoc 中，Run 投影从正式记录读取；内部调度会话不进入业务会话列表。已通过定时执行实际强制终止、恢复同一提交、单次运行完结与禁用验证。
5. 桌面和真实 Tailscale Remote 的发送、工具、审批、队列、取消、配置、刷新和后台恢复已通过实际应用验证。现有组件和渲染样式保留。
6. 移除不再使用的活动 IPC 转发，活动、Run/Trace 和任务面板直接消费 SDK 的展示投影。修正新的开发数据库、迁移、Preload、Remote 和沙箱资源路径。

## 已验证的增量

- `daa6ca4`：真实 Tailscale Remote 页面访问、发送、配置、队列、取消和审批；修正保存的自定义模型 reasoning/容量目录。
- `da21cf2`：桌面/Remote 的稳定请求 ID 与确认丢失重试；新会话模型与创建原子保存；49 项相关测试及七项桌面/生产烟测通过。
- `03865c1`：桌面活动随正式状态刷新，保留多轮工具分组；实机读取工具在运行中、完成后和 renderer 刷新后均能显示。
- `9514fb9`：初始化/关闭失败不截断其余资源清理；真实 Utility Process 在 HTTP 启动后失败，能在同进程重新打开数据库。该版本全量 103 文件、554 项通过、2 项环境跳过。
- 生产备份恢复样本已通过：独立恢复后 SDK 提交回执、Run/Trace、Workspace、禁用调度定义与工具结果可读，模型仅调用一次；样本中的旧历史要求已移除。

29f5e85 清理增量：80 文件、449 项通过、3 项环境跳过，类型检查与 lint 通过；原生后台八种启动/崩溃/恢复及 SDK 工具测试共 20 项通过；参数、工具错误、保留、审批单次授权和业务迁移相关 17 项通过。

## 最终验收

2026-10-11 13:37 至 13:45 的完整串行回归：82 文件全部通过，459 项通过、0 项失败、3 项环境跳过。命令为设置 managed Python PATH 和 NOOK_REMOTE_ACCEPTANCE=1 后运行 `pnpm test --maxWorkers=1`。该轮包含真实桌面 composer、活动、重命名、刷新，以及十种生产后台启动/失败/备份恢复/审批/取消/unsafe/委派/调度/真实 Remote 场景。此前并行回归出现原生测试与构建超时，已完整串行重跑，不将分轮复测拼接为全量通过。

三端类型检查与 lint 已通过。Windows 包内 write、edit、图片 read/Sharp、find/grep/ripgrep 和受限 Shell 六种工具，以及重启后同一提交/历史恢复和模型不重复调用已通过。打包新增 afterPack hook，为沙箱 helper 保留与开发构建一致的文件权限和 Medium 完整性标签。

桌面与 Remote 最终构建已通过。共享包的 assistant-ui 仅用于类型检查，已改为开发依赖；生产依赖树由 400 项降为 305 项，不再包含 React、assistant-ui 等界面运行时，所有包版本保持不变。修正后三端类型检查、lint 及聊天/SDK 工具相关 17 项回归再次通过。

搬迁到 apps/desktop 时新增的 `"type": "module"` 使 CommonJS preload 被按 ESM 解析，`require is not defined` 导致 preload 未加载、`window.api` 缺失，渲染层 `initializeTheme` 随之崩溃。preload 产物改为 `index.cjs` 并同步引用后，dev 启动、renderer 与 Agent 后端均正常。原桌面烟测在 node_modules 下的临时目录构建，Node 的 `type` 查找不越过 node_modules，因此从未覆盖该条件；现已在烟测临时目录写入 `"type": "module"` 的 package.json，回退修复即可复现同一错误。

提交按功能分批推送；提交后的 dev 启动、类型检查、lint、全量测试与目录包验证为本轮最终门禁。

## 环境项

Windows 文件 symlink 特权不可用。Sandbox、Preview、Backup 三项已明确跳过；目录 junction 边界通过。不能把环境跳过描述为安全验收通过。macOS/Linux 打包和断电恢复未在本次 Windows 验收中覆盖。

失败验收残留的部分 node_modules/.nook-desktop-* 和系统 Temp/nook-* 目录，删除命令被自动审批审查以 blocked by policy 拒绝，暂时保留。这些调试目录不进入 Git；正式测试和构建脚本保留。

已完成的旧数据备份保留在用户私有目录，不进入 Git；新范围不再要求迁移或恢复旧会话。最近私有备份为 `C:/Users/kk/AppData/Local/KKlyeeNook/migration-backups/20261011-111538`，独立恢复目录为同级 `migration-rehearsals/20261011-111538`；113 文件、117545368 bytes，四个 SQLite integrity check 通过。该记录不替代新执行存储的恢复验收。

## 恢复与回滚边界

新执行数据的恢复演练可用 `pnpm exec vitest run apps/desktop/src/main/agent/production-smoke.test.ts -t backup-rehearsal --maxWorkers=1` 重复验证。生产恢复必须先停止所有写入，以 createBackup 生成一致性备份，再用 restoreBackup 恢复到独立目录并验证数据库、提交、Workspace 和工具结果；不能直接覆盖正在运行的用户目录。

旧 pi-coding-agent 不能读取 agent.sqlite。回滚应使用备份对应的 SDK 版本和业务 Schema；重新启用旧执行器不会恢复新提交。现有 WAL + synchronous=NORMAL 和强制终止测试验证进程崩溃恢复，不代表断电时所有最新写入均不会丢失。

## 完成判定

只有新执行权威；没有旧执行或数据兼容路径；现有 UI 渲染保留；安全边界和 SDK 恢复成立；最终质量及打包门禁通过；测试过的代码已经提交推送。满足这些条件后才可完成目标。
