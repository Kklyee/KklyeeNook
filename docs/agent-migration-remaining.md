# Agent 迁移：未完成 Spec 与剩余工作

## 1. 范围与当前结论

目标：完成 KKlyeeNook 从旧 `pi-coding-agent` 执行链路到 Pi Durable + pi-ai + Chord 的迁移，直到 M5 验收通过。

本文汇总 `pi-durable-m0.md` 至 `pi-durable-m4.md` 的未完成要求，以及当前工作树中新增实现的剩余验证工作。它是项目迁移的剩余需求与验收清单，不是上游 SDK spec 的全文，也不表示这些项目已经验收。

当前分支：`feat/pi-durable-migration`。本文编写时最近提交：`6022817`。生产接线、历史续接、调度和前端等大量修改仍在工作树中，尚未形成新的已提交版本。

| 阶段 | 当前状态 | 尚未放行的部分 |
| --- | --- | --- |
| M0：SDK / Electron / SQLite 兼容性 | 基础关卡通过 | 不等于完整生产后台验收 |
| M1：唯一宿主、持久会话、提交与恢复 | 核心实现及相关测试通过 | 实际应用启动、恢复、退出的生产验收 |
| M2：模型、指令、工具、权限、审批、输入上下文 | 核心实现及相关测试通过 | 生产设置、MCP、工具与 UI 的完整回归 |
| M3：生产后端、HTTP/SSE、Chat、Remote | 主要接线已改，仍在验收 | 真实生产进程、桌面与 Remote 产品闭环 |
| M4：队列、子任务、调度、资源、历史 | 主要实现已落地，仍在验收 | 并发上限、崩溃矩阵、任务展示、历史兼容 |
| M5：恢复/回滚、最终验收、删除旧链路 | 未完成 | 本文全部最终门禁 |

之前给出的 70%–75% 是实现进度估计，不是按验收条目统计的完成率。M3、M4、M5 均不能标记为已完成。

早期里程碑文档中的“生产尚未接线”等描述属于当时记录；当前源码已经修改生产接线，但仍未完成验收。最新剩余工作以本文为准。

## 2. 必须继续满足的架构与安全约束

- Pi Durable 是执行、Task、Submission、队列、重试、取消与恢复的唯一权威；不新增另一套 Agent/Run 执行循环。
- Drizzle 管理业务元数据和展示投影；前端只管理 UI 投影。运行分组等展示信息不能决定任务调度或重放。
- 只有一个 Agent Backend 进程拥有执行存储；同一业务会话不能同时交给新旧执行器。
- 权限、Workspace 边界、Sandbox、工具结果保留与取消信号必须保留，不能以 full-access 或删除安全测试绕过。
- 审批请求与决定先持久化，绑定真实 Conversation/Task、工具和精确参数；恢复不能自动批准，unsafe 副作用不能自动重放。
- 恢复服务、工具、审批、输入和调度的初始化必须早于 Harness resume。
- 保留现有 Hono secret、Origin、认证与请求体限制；SSE 重连读取正式快照，不猜测丢失执行结果。
- 旧 JSONL 是只读历史数据，不是新执行存储；历史工具调用不得转成新的执行任务或伪造执行记录。
- Agent Chat 优先复用 assistant-ui Elements、ExternalStoreRuntime 和现有样式，不额外引入第二套 Thread Runtime。
- 项目文件和类型按职责命名，不能把 `durable` 当作应用架构名称；SDK 导入与必要的持久标识保留兼容。
- 当前只处理项目源码和迁移验证；MXC 评估不属于迁移剩余门禁，不扩展为额外平台工程。

## 3. M3 未完成 Spec

### M3-01：真实生产后台启动与生命周期

**已实现：** `src/main/agent-backend/bootstrap.ts` 已改为组装 AgentHost，并接入模型、工具、MCP、调度与新 HTTP 服务。

**剩余：**

- [ ] 通过 `src/main/agent-backend/production-smoke.test.ts`，验证真实 Electron Utility Process 的生产 bootstrap，而不只是最小 Harness smoke。
- [ ] 验证应用实际使用 `/api/agent`，旧执行循环没有启动。
- [ ] 验证同一用户数据目录的重复启动被拒绝，启动失败释放所有权。
- [ ] 验证初始化失败、设置重载、进程退出及异常关闭释放 HTTP、watch、MCP、Harness 和资源。
- [ ] 验证设置提交失败时不会留下混合配置或不可恢复的后台状态。
- [ ] 验证业务元数据发布/镜像失败不会提升权限，也不会使已持久的权限收缩在恢复后失效。

**2026-10-10 更新：** tsx loader 修正后仍出现 ESM 循环加载错误。测试现使用项目 electron-vite 实际 main 构建入口，真实生产 Utility Process smoke 已通过，覆盖认证/Origin、同目录重复启动拒绝、无效设置提交回滚、提交与去重、Run/Trace、正常退出和重启稳定性。初始化失败、异常关闭及完整配置故障矩阵仍待验证。

**验收：** 真实 Utility Process 完成启动、认证访问、创建会话、提交、查询完成状态、重复 requestId 去重、运行/Trace 查询和正常退出。

### M3-02：桌面 Chat / ExternalStoreRuntime

**已实现：** ChatStore、ExternalStoreRuntime、ThreadListAdapter、队列适配、持久审批入口和历史继续入口已经接线。

**剩余：**

- [ ] 实际运行桌面，验证新建、切换、重命名、归档、删除及历史会话操作。
- [ ] 验证流式文本、思考、工具参数/结果、图片、附件、Markdown、统计与原有工具展示没有退化。
- [ ] 验证 Workspace/权限草稿、新会话绑定与一个 selectedThreadId 的一致性。
- [ ] 验证连接恢复后 composer、队列、审批与 loading 状态一致，没有重复消息或残留等待。
- [x] 补齐共享 reducer 的正式测试：覆盖全部官方事件类型、完整消息替换、工具参数嵌套 delta、输出 trim/set、null details、重试/延迟、compaction、Inbox、重复 Entry 与连接 reset/gap；ChatStore 测试单独保留。
- [ ] 验证 renderer 刷新/退出后，不依赖前端 Promise 才能继续或恢复执行。

**已有相关测试：** 快照引用缓存、过期切换结果、旧连接事件、重复/跨会话帧、缺口后重新 reset、丢失确认后的稳定提交 ID 与附件、历史惯性展示。

**验收：** UI 只消费后端正式状态；相同提交重试不重复执行，切换与重连不混入其它会话事件。

### M3-03：HTTP / SSE 与元数据 API

- [ ] 完整复验 thread CRUD、模型/thinking、提交状态、撤回、取消、队列及审批路由。
- [ ] 核对正常发送遇到 busy、历史只读、过期队列/审批、不存在会话等错误的 HTTP 状态与客户端提示。
- [ ] 验证 metadata 更新、历史归档/重命名、删除时取消执行的最新变更。
- [ ] 验证 SDK watch 溢出 reset、连接 epoch/sequence、缺口恢复及观察者关闭。
- [ ] 验证审批和队列的独立展示投影不会被客户端误当成原子执行状态。
- [ ] 验证应用后台重启后，客户端获取新认证端点并重新连接，而不持续使用已失效的地址。

**验收：** 所有变更仍绑定业务 threadId，不能跨会话读取 Submission、修改队列或决策审批；断开 SSE 不取消 Agent。

### M3-04：Remote 功能与兼容性

**已实现：** RemoteAgentPort 已改用 AgentHost；已有新的附件、配置、队列、审批、订阅与脱敏测试。

**剩余：**

- [ ] 在实际 Remote 页面验证项目列表、会话列表、发送、流式回复、取消、模型、thinking、权限、队列和审批。
- [ ] 验证后台重启及订阅建立/取消竞争没有 watch 泄漏或错误顺序。
- [ ] 补齐历史活动/工具展示与桌面文本边界的一致性；当前展示投影不能只在工具运行期间可见，完成后丢失。
- [x] 明确并实现旧历史会话在 Remote 的只读可见性与继续入口：保留列表、惰性只读快照、稳定继续目标、原 Workspace/权限及脱敏；历史发送/配置拒绝，失效 Workspace 拒绝继续。实际 Remote 页面验收仍在上一条产品门禁中。
- [ ] 复验 busy/conflict 与历史只读错误，不把正常业务冲突统一返回 500。
- [ ] 验证 context budget 使用当前模型容量与最近模型上下文用量，而不是累积计费 token。
- [ ] 保留脱敏：不暴露本机 session 路径、Provider URL/密钥、opaque signatures 或未授权的原始工具细节。

**验收：** Remote 与桌面控制同一个执行权威，功能没有因替换旧协议而缩减；不能通过删除旧测试来代替兼容验收。

### M3-05：模型 / MCP / Skills / 设置

- [ ] 生产回归内置 Provider、自定义 Provider、API/base URL、thinking、模型输入/容量覆盖与保存的 DeepSeek 别名。
- [ ] 验证 API Key 轮换/删除及配置无效时的失败边界；凭据不进入消息、执行文档或前端快照。
- [ ] 验证 MCP 连接、断开、重试与动态工具列表在新 Host 中生效，并继续走权限/审批。
- [ ] 验证显式 Skill、slash Skill、AGENTS.md、Memory、文本附件和图片的生产传递。
- [ ] 验证新 contextWindow/上下文用量投影在流式生成、模型切换和 compaction 后正确；新用量代码还需要最终全量复验。

## 4. M4 未完成 Spec

### M4-01：官方队列语义与恢复

**已实现：** 使用 SDK InboxDoc/Submission；队列编辑、删除、移动与提升已有实现；Remote 已补提交事务内的 expected 校验和混合模式移动测试。

- [ ] 验证桌面和 Remote 的 normal / steer / followUp / reject 行为一致。
- [ ] 验证跨 mode 的索引、排序、提升、空值与边界校验。
- [ ] 验证准备后的 Skills/附件快照与编辑后的正文语义一致，不错配输入上下文。
- [ ] 补队列操作中的真实进程崩溃测试：提交后确认丢失、排队中、放置中、撤回与取消。
- [ ] 验证 UI 不维护另一份执行队列，重启后从正式状态恢复。

### M4-02：子任务、并发与取消

**已实现：** task-owned Conversation、稳定子提交 ID、显式工具/Extension 继承、父历史隔离、根 Workspace/权限继承及父级取消。

- [ ] 用真实并行委派验证最多两个子任务；第三个调用、同时创建和恢复竞争均不能突破上限。
- [ ] 验证子任务再次委派的执行端拒绝，不只依赖 UI 或工具列表移除。
- [ ] 补子任务创建前后、准入前后、审批中、效果发生后及父取消中的 SIGKILL 矩阵。
- [ ] 验证恢复使用原子会话和原 Submission，不重复工作或 unsafe 效果。
- [ ] 验证子任务 HTTP/SSE、任务面板、运行关系、审批定位和详情跳转的完整生产闭环。
- [ ] 验证父历史不被隐式复制给子任务，只有明确 task/context、选择 Skill 和授权 Memory 被传递。

### M4-03：正式调度 Task

**已实现：** `src/main/scheduler/agent-scheduler.ts` 已接入生产，使用 SDK Task、checkpoint 与稳定 occurrence requestId；相关模块测试通过。

- [ ] 生产验证一次性、每日、每周与本地时区语义。
- [ ] 验证编辑、启用/禁用、删除、错过执行时间及运行中变更的行为。
- [ ] 补派发、准入确认丢失、等待结果及写回业务投影各阶段的崩溃恢复。
- [x] 旧定时任务指向历史会话时保留定义、持久暂停、通知并在任务列表展示原因；启用须选择显式继续后的新会话。恢复与派发都检查历史目标，避免静默重放或循环失败，相关正式测试通过。
- [ ] 验证设置/权限/Workspace 变化在实际派发时重新检查。
- [ ] 验证旧 ScheduledTaskScheduler 不再被生产启动；不允许两套调度器处理同一条任务。

### M4-04：Run 资源与 Sandbox

**已实现：** 根 SDK Run 共享资源标识；Windows backend 已增加跨进程目录发现、重用/清理与真实路径/junction 边界检查。

- [ ] 真实应用验证同一 Run 的多工具、子任务共享资源，后续新 Run 不错误复用旧作用域。
- [ ] 验证正常完成、取消、初始化失败和关闭均回收资源。
- [ ] 补 SIGKILL 后新进程发现旧资源、恢复执行与最终回收的完整链路。
- [ ] 验证真实目录、symlink/junction、Workspace detach、输出保留和取消信号，不降低原安全边界。
- [ ] 将现有环境跳过项明确记录，不能将跳过描述为安全验收通过。

### M4-05：运行与 Trace 展示投影

**已实现：** `run-membership.ts` 记录正式 Run 首个输入与生成 Task 的展示归属；`run-projection.ts` 从 SDK Task/Entry/ownership 派生运行与 Trace。完成后的工具结果及重启稳定性已有测试。

- [ ] 验证多轮模型/工具调用属于同一个真实 Run，而不是每轮生成都被展示成独立运行。
- [ ] 验证 steer、followUp、重试、compaction、失败/取消、恢复后的分组和状态。
- [ ] 验证子任务父子关系、详情标识与现有 `durable-child:*` 兼容。
- [ ] 验证运行中增量显示、最终历史、任务面板和 Remote 活动，不只验证查询接口。
- [ ] 验证展示分组丢失/失败不产生新的调度权威，也不改变工具重放策略。

### M4-06：历史只读与明确继续

**已实现：** LegacyHistory 读取选定分支及 Drizzle 备选历史；历史记录以惯性数据展示。显式继续创建独立线程，在创建事务中冻结历史，不生成历史执行 Task。跨重启与源文件变动后的冻结测试已通过。

- [ ] 审计真实旧版本 JSONL、分支、branch summary、compaction、坏行、缺失文件与旧消息投影的兼容性。
- [ ] 验证历史目录与 threadId 所有权、路径/junction 边界，不读取其它会话或授权目录外数据。
- [ ] 验证文本、思考、图片、工具调用/输出、摘要和读取诊断的只读展示。
- [ ] 验证历史归档/重命名/删除元数据行为与明确继续的 UI 入口。
- [ ] 验证继续目标已存在时拒绝覆盖；重复继续和业务发布失败重试保持同一份冻结内容。
- [x] 历史 prompt 使用当前模型容量的四分之一字节预算且最多 32 KiB，选取最新 compaction 摘要、first-kept 起点和近期文本；图片不作为 base64 prompt 文本传递，提示重新附件，opaque signature/隐藏思考不传递。完整冻结记录保留在历史展示，预算是保守字节边界，不冒充精确 tokenizer 计数。超长 CJK、图片、摘要、容量切换测试通过。
- [ ] 明确继续后的 Workspace/权限绑定及失效 Workspace 的提示，不自动扩权。
- [ ] 证明旧 JSONL/历史工具调用没有成为执行存储或新的执行意图。

## 5. M5 未完成 Spec

### M5-01：停机备份与恢复演练

- [ ] 在应用停止写入后生成新的正式迁移备份，覆盖业务数据库、旧 sessions、新执行数据库、定时任务和工具结果/资源索引。
- [ ] SQLite 使用一致性备份方式；资源目录与数据库之间的一致性边界必须明确。
- [ ] 记录清单、大小/校验值、Schema/版本和 `PRAGMA integrity_check` 结果。
- [ ] 恢复到独立演练目录并验证历史、Workspace、任务和资源可读；不覆盖真实用户数据。
- [ ] 验证备份不进入 Git、不包含对外泄露的用户凭据。

之前的 96 文件 / 117459475 bytes 备份及五个 SQLite integrity check 只证明当时的备份结果；不替代新的停机备份或恢复演练。

### M5-02：真实崩溃与产品验收

- [ ] 真实生产 Utility Process 启动与退出 smoke 通过。
- [ ] 桌面与 Remote 完成 M3 全部产品闭环。
- [ ] M4 队列、子任务、调度和资源的崩溃矩阵通过。
- [ ] 审批等待恢复、效果已发生后的 unsafe 中断、重复提交去重与过期审批拒绝均在生产接线下验证。
- [ ] 验证业务数据、旧历史、Workspace 和重要资源没有丢失。
- [ ] 验证进程崩溃与断电保证的差异；不能把 WAL + synchronous=NORMAL 描述为完整断电不丢数据。

### M5-03：删除旧源码、协议与依赖

**目前阻塞，必须在上述验收通过后执行。**

- [ ] 删除旧 Agent/Coding Agent 执行循环、旧 Pi session/runtime/client 管理与旧调度执行器。
- [ ] 删除旧 HTTP/Pi 协议处理和未使用的 renderer Runtime/UI prompt 路径。
- [ ] 将仍复用的工具实现保留为独立能力，清除旧 Coding Agent 类型/工厂耦合。
- [ ] 审计并移除无使用者的 `@earendil-works/pi-coding-agent`、`@earendil-works/pi-agent-core`、`pi-ai-legacy`、`@assistant-ui/react-pi` 等过渡依赖及 override；以引用审计结果为准。
- [ ] 更新 lockfile、构建配置、测试 fixture 和职责命名。
- [ ] 验证 YAML、图片 read/resize、find/grep、edit/write、命令与 MCP 的能力没有因删包消失。
- [ ] 验证 ripgrep 平台二进制、sharp/@img 在打包应用中的解析与 asar 解包；开发构建成功不等于打包后可运行。
- [ ] 保留旧用户历史和备份；删除旧实现不代表删除旧数据。

### M5-04：最终质量门禁、文档与交付

- [ ] 对最终源码重新运行全部类型检查、lint、测试、桌面/Remote 构建和必要的打包验证。
- [ ] 不删核心测试、不降低安全策略、不把孤立复验拼成“最终全量通过”。
- [ ] 更新里程碑文档中的旧状态与最终验收记录，注明未覆盖的平台/环境项。
- [ ] 清理调试临时文件和日志，保留正式测试与构建文件。
- [ ] 将通过测试的连贯增量提交并推送到授权分支；当前未提交工作不算已交付。
- [ ] 最终记录 commit、测试数量、构建产物、备份位置、恢复步骤和回滚边界。

## 6. 当前验证事实与未通过项

| 验证 | 最近记录 | 注意事项 |
| --- | --- | --- |
| Node / Web / Remote 类型检查、lint | 在近期版本通过 | 新增生产 smoke 及后续源码仍需最终复验 |
| 桌面 + Remote 构建 | 近期 `pnpm run build` 通过 | 后续元数据/测试变更后需重跑；尚不是安装包验收 |
| 全量测试 | 2026-10-10 当前源码 101 文件通过；537 通过、2 跳过 | 使用 managed Python 仅调整测试子进程 PATH；后续更改仍需最终全量重跑，跳过不算安全验收 |
| 全量中的两个失败 | Office PDF 与 Sandbox ACL 测试超时 | 后续隔离复验通过，不替代最终全量重跑 |
| 旧 UI mock 加载失败 | 已补新 Runtime mock，相关 suite 复验通过 | 不能据此声称其它桌面 UI 已验收 |
| 新核心相关复验 | 2026-10-10 45 文件 / 253 测试整体通过 | 包括真实生产 smoke、共享 reducer、Host、Engine、Remote、Scheduler、Backup、ChatStore，非完整产品门禁 |
| Backup / Scheduler 模块 | 近期相关测试通过 | 仍缺实际恢复演练及生产崩溃矩阵 |
| 生产 Utility Process smoke | 2026-10-10 实际 main 构建后通过 | 覆盖认证、重复启动、设置回滚、提交、重启和退出；尚未覆盖完整异常/崩溃矩阵 |
| 旧依赖清理 | 未执行 | `pi-coding-agent` 等依赖仍在 |
| 新增实现交付 | 连贯增量开始提交；迁移未完成 | 2026-10-10 核心回归 44 文件 / 239 项通过，类型检查及 lint 通过；不替代最终全量门禁 |

## 7. 建议执行顺序

1. **P0：固定生产启动闭环。** 先使 production smoke 通过，补核启动/恢复/退出、元数据权限和错误状态。
2. **P0：补产品兼容缺口。** 桌面完整联调；Remote 历史与活动展示；大历史/compaction prompt；定时任务历史目标策略。
3. **P1：完成 M4 验收。** 队列、两个子任务上限、运行分组、审批与资源的真实崩溃矩阵。
4. **P1：恢复/回滚演练。** 停机备份，隔离恢复，明确新执行数据与旧程序之间的回滚边界。
5. **P1：移除旧链路。** 验收通过后删除旧源码/协议/依赖，补包后工具验证。
6. **P1：最终门禁与交付。** 全量类型检查/lint/测试/build，更新文档，提交并推送。

不能为了先删掉旧包而逆转这个顺序。

## 8. 验证命令

基础门禁：

```powershell
pnpm run typecheck
pnpm run lint
pnpm run build
```

优先复验生产后台：

```powershell
pnpm exec vitest run src/main/agent-backend/production-smoke.test.ts --maxWorkers=1
```

核心迁移回归：

```powershell
pnpm exec vitest run src/main/agent src/main/agent-backend src/main/remote src/main/scheduler/agent-scheduler.test.ts src/main/migration src/renderer/src/features/chat/runtime/chat-store.test.ts --maxWorkers=2
```

完整回归使用已安装的 managed Python，仅修改测试子进程 PATH，并在结束后恢复：

```powershell
$originalPath = $env:PATH
try {
  $python = uv python find --python-preference only-managed --no-python-downloads
  if ($LASTEXITCODE -ne 0) { throw 'Managed Python unavailable' }
  $env:PATH = (Split-Path $python) + ';' + $originalPath
  pnpm test --maxWorkers=2
  $code = $LASTEXITCODE
} finally {
  $env:PATH = $originalPath
}
exit $code
```

## 9. 完成判定

只有 M3、M4、M5 的未勾选项全部完成，或明确列出的非阻断例外经过确认，才可以宣布 spec 完成。

必须同时满足：生产只有新执行权威；桌面/Remote 关键功能保留；恢复与 unsafe 副作用安全成立；旧数据可读且可明确继续；停机备份与隔离恢复成立；旧执行源码/协议/依赖已清理；最终门禁通过；测试过的代码已提交并推送。
