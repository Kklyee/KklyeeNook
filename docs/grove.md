# Grove v0.2

## 当前进度

- Phase 1：本地 Bot 通信、Durable 协作执行、Chat 与 Grove 入口已实现。
- Phase 2：已实现网络身份、Host / User 凭据校验、Social Grant 授权核心及 PostgreSQL 操作存储。Relay HTTP API、Remote Transport、Inbox / Outbox 和管理 UI 尚未实现。
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

继续开发时将现有本地协议扩展至 Remote Transport，并接通 Relay HTTP API、Host Inbox / Outbox 和管理 UI；不能把现有 Desktop Remote Gateway 的设备访问凭据直接当作跨用户 Bot 身份。

## 网络授权基础

`packages/shared/src/bot/social.ts` 定义 Network Bot Identity、User / Bot Principal、Social Grant 和 Network Operation。`SocialAuthorization` 默认拒绝跨用户操作，严格匹配 Principal 类型、ID、目标 Bot 所有者和权限动作，并检查撤销、到期、使用次数与工具范围。

`apps/grove` 是 Grove Server 的独立服务包。目前包含 PostgreSQL 数据结构、连接管理和存储服务，尚未提供对外 HTTP 服务。`users` 与 `host_devices` 分别存储高熵 User / Host 访问凭据的 SHA-256 摘要，Host 注册由已认证 User 发起，网络 Bot 注册由已认证 Host 发起。凭据不能互换；发送方不能代表其他 Host 的 Bot。

Social Grant 仅由目标 Bot 的所有者 User 签发或撤销。User Grant 不扩展至该 User 的 Bot。一次 Operation 的授权检查、限次统计和记录写入同一个 PostgreSQL 事务，锁定 Grant 行并对 Operation ID 取事务级锁；重复请求复用原始记录，修改参数后重复使用 ID 会被拒绝。对排队操作提供目标 Host 执行前的授权复核，撤销、到期或禁用发送 Host 都会阻止后续执行。后续 Host Bridge 必须调用此复核后才执行副作用。

服务器表为 `users`、`host_devices`、`network_bots`、`relationships`、`social_grants`、`network_operations` 与 `network_messages`。关系和消息表已建立，具体 Relay 投递逻辑仍需继续实现。

授权单元测试及 PGlite 嵌入式 PostgreSQL 集成测试验证身份不可冒用、同名 Bot 隔离、跨主体 Grant 隔离、限次并发、Operation 去重、权限撤销和 MCP 范围边界。PGlite 使用 PostgreSQL 引擎；目前尚未在独立 Docker PostgreSQL 服务上做部署验证。
