# Pi Durable M3：传输接入进度

## 当前边界

生产 `agent-backend/bootstrap.ts` 已接入 AgentHost、新 HTTP/SSE、MCP、工具与正式调度 Task，桌面接入 ChatStore / ExternalStoreRuntime，Remote 接入同一 Host。M3 仍未完成；真实桌面与 Remote 的产品回归和剩余兼容门禁以 `agent-migration-remaining.md` 为准。同一产品会话只交给新执行器。

2026-10-10 生产 Utility Process smoke 使用项目 electron-vite 的实际 main 构建配置，验证 `/api/agent`、secret / Origin 边界、同目录重复启动拒绝、无效设置提交回滚、提交完成、稳定 requestId 去重、Run / Trace 查询、正常退出和重启后正式回执稳定。没有使用 tsx loader 或以最小 Harness smoke 代替生产启动。当前核心迁移回归为 44 个文件 / 239 项通过，Node/Web/Remote 类型检查与 lint 通过；这不是 M3/M4/M5 最终全量或产品验收。

## 已完成：HTTP / SSE 基础

`src/main/agent-backend/agent-http.ts` 提供 `/agent/threads`、会话快照、稳定 requestId 提交、Submission 状态/撤回、取消及持久审批决策 API。复用原 Hono 服务的随机 secret 路径、Origin 白名单、4 MiB 请求体限制、错误响应及关闭方式，不引入第二套认证。

输入只允许 SDK input draft、显式文本/图片块、Skill 与附件引用。禁止客户端通过 HTTP 提交任意 write Entry 或附加未识别字段。Submission 与审批操作均绑定 URL 中的业务 threadId，不能跨会话读取或决策。

SSE 转发官方 watchEvents 初始快照及提交事件批次，官方积压溢出产生的 snapshot 同样作为 reset。每个连接拥有独立 epoch 与递增 sequence；这是连接内的传输序号，不冒充 Durable 持久 Seq。重连始终重新捕获正式快照，不猜测丢失事件或重放副作用。

审批 Document watch 补充请求变化；每帧附带当前 pending 审批及正式 InboxDoc 原始队列文本。它们是独立读取的展示投影，不宣称与事件批次属于同一个持久提交。审批是否仍有效及队列撤回均由后端正式任务/Submission 操作判定。

Host 在创建会话的原子事务中初始化审批文档；打开已有映射时在 resume 前补齐缺失文档。HTTP/SSE 断开只释放观察者，不取消运行、不持有审批 Promise 或代替 Durable 恢复。SSE 写入由连接的 Chord Context 约束，关闭释放两类 watch。

## 已验证

`src/main/agent/agent-host.test.ts` 新增三个真实 HTTP/SSE 测试，验证认证、拒绝任意 Entry 写入、requestId 幂等、跨会话隔离、正式队列状态/撤回/取消、过期审批拒绝，以及 SSE 顺序、重连 reset 与断开不终止执行。已有 HTTP 服务回归继续通过。Node/Web/Remote 类型检查、lint 与完整桌面/Remote 构建通过。全仓测试为 94 个文件、497 项通过、2 项原有环境跳过；使用已安装的 uv-managed Python 临时调整测试子进程 PATH，未修改系统 PATH 或跳过策略。

## 待完成

- ChatStore 的展示投影 reducer、失序/缺口恢复与前后端协议联调。
- ExternalStoreRuntime / ExternalStoreThreadListAdapter 与桌面、Remote 的实际接线。
- Thread metadata CRUD、模型选择、历史会话只读及继续入口的完整 API。
- 补齐生产初始化失败、异常关闭、MCP 与设置重载失败的完整生命周期矩阵；不能将独立模块测试当作生产切换验收。
- M4 任务/调度/历史迁移及 M5 产品、崩溃、回滚验收通过后删除旧实现和依赖。

## 2026-10-10 兼容增量

共享事件 reducer 现使用 Chord 的不可变 delta 处理工具参数，保留输出窗口 trim/set 与 null details，覆盖重试、延迟、compaction 和全部官方事件类型。Remote 与桌面复用此 reducer；Remote 的工具/思考活动从正式历史 Entry 派生，并复用现有活动分组与文本边界算法，完成后仍可重新查询。原始工具参数、内部 details、路径和 opaque signature 不加入 Remote 活动。

Remote 保留历史会话的列表和只读展示，提供稳定目标 ID 的明确继续入口；失效 Workspace 拒绝继续，原权限与 Workspace 保留。HTTP 和 Remote 对 busy、历史只读、过期队列/审批和跨会话读取分别返回业务冲突或不存在状态。正式测试覆盖这些行为及订阅初始化失败/取消竞争，未以删除旧协议测试替代产品验收。

当前整体核心迁移回归为 45 文件 / 253 项通过，Node/Web/Remote 类型检查、lint、桌面/Remote 构建通过。实际桌面/Remote 页面、真实 SIGKILL 矩阵、停机备份恢复及删除旧链路仍待验收。

后续生产 smoke 以显式 production 模式构建，四个场景覆盖生命周期、审批等待强制终止、取消后强制终止和受限 Shell 效果已发生后的强制终止。恢复保持原 Submission、排队编辑内容、待决定审批和去重；unsafe 效果只发生一次并返回正式 interruption，旧 Sandbox 资源最终回收。Windows 使用 UtilityProcess.kill 的进程强制终止，不能把它描述为断电验收。

新增桌面 smoke 构建并启动真实 main/preload/renderer，在隔离数据目录通过实际 composer 和菜单验证新建/发送、正式回复、重命名与刷新后恢复。修复 SDK system 指令被投影为空 assistant 气泡的问题；system 仍保留在正式 transcript 中。该轮整体核心回归为 47 文件 / 263 项通过，全部类型检查及 lint 通过，仍不等于全部产品门禁。
