# Agent 迁移：当前范围与验收

## 范围

2026-10-11 用户明确调整要求：以前的会话数据可以舍弃，不做旧数据兼容；根据最新 Pi Durable 的数据结构修改后端和 Agent，保持现有 UI 渲染，代码必须干净、简洁、易读。随后要求把桌面放入 apps/desktop，并允许独立整理 Agent/Server；当前采用 apps/desktop 与 apps/agent，共享协议留在 packages/shared。

此要求优先于初始 goal 文件及 M0–M4 文档中的历史兼容、旧 JSONL 读取、历史续接和旧数据恢复要求。旧里程碑文档仅保留过程记录，不再作为继续实现兼容层的依据。

当前分支为 `feat/pi-durable-migration`，已推送至 `9514fb9`。npm 的最新 `@earendil-works/pi-durable` 为 `1.1.0`，项目已使用该版本；已核对官方 README、SDK 类型及 Context7 `/earendil-works/pi` 文档。

## 设计约束

- Pi Durable 的 Conversation、Task、Submission、Entry、LiveDoc、InboxDoc 和 watchEvents 是执行、队列、取消、重试与恢复的唯一权威。
- Drizzle 只保存 Workspace、设置、Memory、调度定义等业务数据及必要的会话业务信息；不建立第二套执行状态。
- 保持现有消息、思考、工具、图片、Markdown、活动与任务面板的渲染组件和样式。只保留 SDK 数据到 UI 的必要投影。
- 删除旧执行器、旧协议、历史兼容、无使用者的适配器与依赖，不保留双路径或旧数据回退。
- 保留认证、Origin、请求大小、Workspace、Sandbox、审批、工具结果保留和取消边界。
- 不添加代码注释，不引入没有实际用途的抽象、配置项或防御分支。

## 剩余工作

1. 已移除旧会话读取、冻结历史、续接入口、历史标记和旧 Run/Trace 回退，只列出 SDK 管理的会话。
2. 已删除旧 Agent/Pi runtime/client、旧调度器和旧 HTTP 协议；复用工具集中到 tools，SDK 工具与安全验证保留。接下来整理 apps/desktop、apps/agent 和公共协议依赖。
3. 已移除 pi-coding-agent、pi-agent-core、pi-ai-legacy、react-pi 及其 override/补丁，更新 lockfile；执行存储改为 agent.sqlite，旧执行表迁移删除。
4. 核对 SDK 会话、输入、队列、子任务、调度、模型/MCP/Skills 和资源生命周期；补齐生产恢复与取消验证。
5. 验证桌面和 Remote 的现有渲染及功能；通过正常发送、工具、审批、队列、重试、刷新和后台重启闭环。
6. 完整类型检查、lint、测试、桌面/Remote 构建及打包后工具验收；清理临时文件，提交并推送。

## 已验证的增量

- `daa6ca4`：真实 Tailscale Remote 页面访问、发送、配置、队列、取消和审批；修正保存的自定义模型 reasoning/容量目录。
- `da21cf2`：桌面/Remote 的稳定请求 ID 与确认丢失重试；新会话模型与创建原子保存；49 项相关测试及七项桌面/生产烟测通过。
- `03865c1`：桌面活动随正式状态刷新，保留多轮工具分组；实机读取工具在运行中、完成后和 renderer 刷新后均能显示。
- `9514fb9`：初始化/关闭失败不截断其余资源清理；真实 Utility Process 在 HTTP 启动后失败，能在同进程重新打开数据库。该版本全量 103 文件、554 项通过、2 项环境跳过。
- 后续新增生产备份恢复样本已通过：独立恢复后 SDK 提交回执、Run/Trace、Workspace、禁用调度定义与工具结果可读，模型仅调用一次。尚需按新范围去掉样本中的旧历史要求，并完成最新源码全量验证。

当前清理增量：类型检查、lint 通过；原生后台八种启动/崩溃/恢复及 SDK 工具测试共 20 项通过；参数、工具错误、保留、审批单次授权和业务迁移相关 17 项通过。新增全量测试尚待结果，最终构建和打包未完成。

以上是各增量的验证记录，不代表当前迁移完成，也不能拼接为最终全量通过。

## 环境项

Windows 文件 symlink 特权不可用。Sandbox、Preview 的两个跳过已明确记录；原备份 symlink 测试静默返回“通过”，现已改成显式跳过，后续全量应如实报告三项。目录 junction 边界已验证。不能把环境跳过描述为安全验收通过。

已完成的旧数据备份保留在用户私有目录，不进入 Git；新范围不再要求迁移或恢复旧会话。最近私有备份为 `C:/Users/kk/AppData/Local/KKlyeeNook/migration-backups/20261011-111538`，独立恢复目录为同级 `migration-rehearsals/20261011-111538`；113 文件、117545368 bytes，四个 SQLite integrity check 通过。该记录不替代新执行存储的恢复验收。

## 完成判定

只有新执行权威；没有旧执行或数据兼容路径；现有 UI 渲染保留；安全边界和 SDK 恢复成立；最终质量及打包门禁通过；测试过的代码已经提交推送。满足这些条件后才可完成目标。
