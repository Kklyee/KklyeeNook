# Grove v0.2

## 当前进度

- Phase 1：本地 Bot 通信、Durable 协作执行、Chat 与 Grove 入口已实现。
- Phase 2：已实现网络身份、Host / User 凭据校验、Social Grant、连接邀请、PostgreSQL Relay HTTP API、Remote Transport、Host Inbox / Outbox 和 Durable Bridge。Desktop 已接入连接设置、加密凭据、连接管理、权限编辑器及远程协作目标选择；完整桌面交互验收尚未完成。
- Phase 3：受控远程 MCP 分享、委托安装及审批尚未实现。
- Phase 4：不属于 v0.2 首期范围。

## 本地通信

`BotCommunicationService` 使用本地 Host 直接投递任务，不连接网络服务器。普通消息只写入 `bot_messages`，不触发模型。协作请求写入 `bot_tasks`，由 `nook.grove.task` 后台 Durable Task 投递并追踪结果。

三个工具通过 `ToolRegistry`、`AgentTools.extension()` 和现有 Tool Execution Harness 执行：

- `bot.send_message({ toBotId, content })`
- `bot.request_task({ toBotId, instruction })`
- `bot.get_task({ taskId })`

工具不接受 `fromBotId`，来源从 Durable Conversation 的业务身份解析。任务状态和结果只允许参与任务的 Bot 查询。工具调用 ID 生成稳定 Operation ID，重复使用不同内容会被拒绝。

新 Bot 默认启用 Grove 工具。已有内置 Bot 仅在工具配置仍与旧默认值完全相同时自动启用；定制工具配置保持原样，可在 Bot 设置中启用。

## 执行与恢复

目标 Bot 使用自己的主会话、模型、Instructions、enabledTools 和授权 Workspace。提交通过现有 `AgentInputs` 捕获目标配置；不会复制发送方的 Workspace、附件、Memory 或会话历史。

输入使用 `grove:<taskId>`，结果回传使用 `grove:<taskId>:result`。Pi Durable 1.1.0 的 input Submission 不支持示例设计稿中的 `entry`，Grove 关联数据保存于 `nook.input` 文档。

忙碌时使用 `whenBusy: "followUp"` 排队。后台任务恢复后复用已保存 Submission ID；在提交和保存 ID 之间崩溃时，稳定 requestId 仍可找回同一次 Submission。完成结果先持久化，再通过稳定 requestId 回传发起会话。结果汇总输入禁用工具，避免结果触发新的委托链。

接收策略、工作区及工具权限在执行前复核。普通消息和任务的接收开关独立，也支持通过 API 设置来源 Bot 白名单。社交接收策略持久化于 `nook.grove` 会话级 Durable 文档。

## 执行限制

- 协作深度最多 2 层。
- 每个父任务最多 3 个子任务，链路最多 8 个任务。
- 每个 Bot 最多 4 个未结束的协作请求；模型使用既有会话队列执行。
- 每条链路最多 24 个 Generation Task，结果汇总也计入预算。
- 每个 Bot 每分钟最多发送 30 条消息或任务请求。
- 链路运行期限 5 分钟；到期撤回待执行 Submission 或终止对应活动 Run。
- 拒绝自调用和链路内重复目标，委托子会话继承协作链路标识。

这些限制使用固定默认值，不提供额外策略语言。Generation Task 预算不是精确 token 或金额计费系统；供应商在一次 Generation 内部的重试不单独计数。

## 本地 API 与界面

API 使用既有本地认证服务及秘密路径：

- `GET /grove`：本地所有者读取消息、任务、接收策略与限制。
- `POST /grove/messages`：`threadId`、`toBotId`、`content`、`operationId`。
- `POST /grove/tasks`：`threadId`、`toBotId`、`instruction`、`operationId`。
- `PUT /grove/policies/:botId`：`messages`、`tasks`、`allowedBotIds`。

Grove 展示本地 Bot 的接收策略、消息与协作记录。Chat 展示本会话关联的协作请求、状态和可展开结果，并提供手动协作入口。该 API 尚不对远程用户开放。

## 验证

`apps/agent/src/runtime/agent-host.test.ts` 的 Grove 集成测试使用真实 Pi Durable、数据库迁移、ToolRegistry、权限 Harness 和本地模拟模型服务，覆盖：

- 普通消息不调用模型、重复发送去重、拒绝身份伪造。
- 目标 Bot 的独立模型、Instructions、Workspace 和结果关联。
- 小芽经真实工具调用请求 Coder，再汇总结果。
- 重启后复用任务及 Submission，恢复排队任务。
- 接收策略撤回后拒绝尚未投递的任务。
- 参与者查询边界、自调用与协作循环限制。
- 持久化 Generation 预算和执行前授权复核。
- 空答案的明确失败结果。

本地协议已扩展至 Remote Transport、Relay HTTP API 与 Host Inbox / Outbox；Grove 使用独立的 User / Host 凭据，不使用 Desktop Remote Gateway 的设备访问凭据作为跨用户 Bot 身份。

## 网络授权基础

`packages/shared/src/bot/social.ts` 定义 Network Bot Identity、User / Bot Principal、Social Grant 和 Network Operation。`SocialAuthorization` 默认拒绝跨用户操作，严格匹配 Principal 类型、ID、目标 Bot 所有者和权限动作，并检查撤销、到期、使用次数与工具范围。

`apps/grove` 是 Grove Server 的独立服务包，包含 PostgreSQL 数据结构、连接管理、存储服务和 HTTP Relay。`users` 与 `host_devices` 分别存储高熵 User / Host 访问凭据的 SHA-256 摘要，Host 注册由已认证 User 发起，网络 Bot 注册由已认证 Host 发起。凭据不能互换；发送方不能代表其他 Host 的 Bot。

Social Grant 仅由目标 Bot 的所有者 User 签发或撤销。User Grant 不扩展至该 User 的 Bot。一次 Operation 的授权检查、限次统计和记录写入同一个 PostgreSQL 事务，锁定 Grant 行并对 Operation ID 取事务级锁；重复请求复用原始记录，修改参数后重复使用 ID 会被拒绝。对排队操作提供目标 Host 执行前的授权复核，撤销、到期或禁用发送 Host 都会阻止后续执行。后续 Host Bridge 必须调用此复核后才执行副作用。

服务器表为 `users`、`host_devices`、`network_bots`、`relationships`、`social_grants`、`network_operations` 与 `network_messages`。

授权单元测试及 PGlite 嵌入式 PostgreSQL 集成测试验证身份不可冒用、同名 Bot 隔离、跨主体 Grant 隔离、限次并发、Operation 去重、权限撤销和 MCP 范围边界。PGlite 使用 PostgreSQL 引擎；目前尚未在独立 Docker PostgreSQL 服务上做部署验证。

## Relay HTTP 服务

设置 `GROVE_DATABASE_URL` 后，在仓库根目录运行 `pnpm --filter @kklyeenook/grove user:create "Alice"` 生成 User 身份及一次输出的访问凭据，再运行 `pnpm --filter @kklyeenook/grove start`。服务默认绑定 `127.0.0.1:43128`，可通过 `GROVE_HOST` 和 `GROVE_PORT` 设置监听地址。网络部署须通过 HTTPS 反向代理访问；在 Desktop Grove 页输入 Relay URL 和 User 凭据以注册本机 Host。

所有受保护 API 使用 Bearer 凭据。User 管理操作与 Host 通信操作分别认证；HTTP 输入使用严格 Schema，禁止请求体伪造 User、Host、Grant 签发者或消息来源。

User API：`GET /me`、`POST /hosts`、`DELETE /hosts/:id`、`GET /connections`、`POST /relationships`、`POST /relationships/:id/decision`、`POST /grants`、`DELETE /grants/:id`。

Host API：`GET /host`、`POST /bots`、`GET /host/bots`、`POST /messages`、`GET /inbox`、`POST /inbox/:id/ack`、`POST /operations/:id/authorize`、`POST /operations/:id/result`。

连接邀请只能由接收 User 同意或拒绝，任一参与 User 可撤销连接。联系人目录仅显示自己的 Bot 与已接受连接的远程 Bot；建立连接不会自动授予任务或工具权限。

Relay 在同一事务中保存已授权 Operation 与消息，避免只消耗限次授权却丢失消息。请求重复发送时复用原消息，接收方确认已持久化到本地后才发送 ack，未确认的消息仍保留在 Inbox。任务结果仅允许原始目标 Host 回传，服务器固定其来源、目标和 correlationId；重复结果幂等，修改已持久化结果会被拒绝。

Inbox 投递前复核授权与任务截止时间，撤销或过期请求不会送入目标 Bot；任务拒绝结果通过原关联 ID 返回发起 Host。远程请求默认禁止递归委托，最多同时保留 4 个未结束任务，每个发送 Bot 每分钟最多发送 30 条请求或普通消息。结果回传不消耗新的发送授权。

新增 Relay 集成测试覆盖真实 TCP HTTP 请求、离线消息保留、回执权限、去重、关联结果、授权撤销、截止时间、队列和频率上限、严格身份字段校验及请求体大小限制。

## Host 网络执行与恢复

`AgentHostOptions.groveTransport` 接收 `RemoteTransport`。Transport 要求 HTTPS，允许测试或本地部署使用 loopback HTTP，禁止 URL 内携带凭据及跟随重定向。Host 凭据由回调提供，不保存在消息、任务、身份或 Inbox / Outbox 数据中。

Desktop 使用现有加密 CredentialStore 保存 User / Host 凭据，配置文件仅保存公开身份与 Relay URL。User 凭据留在 Main 进程，Agent 后端只收到 Host 凭据。连接设置支持运行中暂停和恢复，保留原始身份及持久化队列；恢复前验证 Host 所有权。管理 IPC 仅接受主窗口主 Frame。权限编辑器区分 User / Bot 主体，支持目标 Bot、动作、Tool / MCP 范围、使用次数、到期时间和撤销；工具权限动作的实际执行闭环仍待 Phase 3。

Host 本地新增 `network_identity`、`remote_contacts`、`social_inbox` 与 `social_outbox`。Durable 后台网络任务注册 Bot、刷新联系人、重试待发送事件、拉取 Inbox 并处理本地恢复记录。Inbox 先持久化到 SQLite，再向 Relay ack；如果在提交或 ack 周围退出进程，持久化 Inbox 和稳定的 requestId 可恢复原始任务，避免重复 Submission。Outbox 保存原始 payload 和 Operation ID，发送失败会保留并重试；明确拒绝会记录失败，已结束任务不会继续发出。

身份解析层将本 Host 的 networkId 规范化为 localBotId，跨 Host 使用全局 networkId。Relay 地址及已注册身份与本地持久化状态绑定，不能在恢复待处理记录时静默更换 Relay 或 Host 身份。

远程任务进入单独的协作 Conversation，使用目标 Bot 的模型和 Instructions，不继承私有主会话。输入不加载 Memory、附件或本地 Skill 清单，也不自动关联 Workspace。远程模型工具调用目前默认拒绝，后续受控共享必须单独接入 `tool.invoke` 检查；接收协作授权不会隐式变成资源或工具执行授权。跨网络递归委托被拒绝，接收端最多使用 23 次 Generation，为发起方的一次结果汇总保留预算。

接收请求、生成模型调用及工具执行前都会复核远程授权和本地接收策略。临时 Relay 故障会等待或重试，始终受原始截止时间约束；撤销或拒绝不会被当作临时故障继续执行。

`apps/grove/src/host-bridge.test.ts` 通过两个独立 Node Host 子进程、各自的 SQLite 数据库、真实 Pi Durable、模拟模型服务及 TCP Relay 验证跨用户执行、模型和上下文隔离、离线接收、完整进程退出后恢复、任务 / Submission 去重、授权撤销、接收策略拒绝及运行中暂停恢复。`connection.test.ts` 验证 Desktop 凭据加密、身份绑定、重用注册及配置回滚，`groveIpc.test.ts` 验证管理入口来源边界。下一阶段完成受控 MCP 分享和委托安装。
