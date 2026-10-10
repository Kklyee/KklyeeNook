# Pi Durable M4 / M5 进度与验收边界

## 尚未完成

M4 和 M5 未完成。生产 bootstrap、Chat ExternalStoreRuntime 和 Remote 尚未切换，不能删除旧执行器或其依赖，也不能将新模块的集成测试视作产品验收。

## 本次已验证的 M4 实现

- `delegation.ts` 使用官方 replay-safe ToolTask、task-owned Conversation 和稳定 requestId。恢复通过正式 ownership 索引复用同一子会话/提交，不创建第二份工作。
- 父任务最多同时拥有两个执行中的子会话；子会话移除 delegate 工具，执行端也拒绝 task-owned 会话再次委派。并发限制读取正式任务记录及 ownership 索引，不另建运行状态机。
- 子会话只接收明确 task/context、选择的 Skill 与 Workspace Memory，不复制父会话 Transcript。继承父会话解析出的 extension/tool 显式列表，保留权限、审批和上下文 sections。
- AgentEngine 根据正式 Conversation ownership 找到根业务会话。子任务工具每次重新读取根 Workspace/权限；父级取消由 SDK 自底向上取消所有普通 owned work。
- `run-resources.ts` 按根 Conversation 与正式 run 的首个 Submission 分配 Sandbox 资源标识。同一 Run 的多次工具调用及子任务共享标识；官方 LiveDoc 表示 Run 结束后释放。资源 lease 是清理元数据，不替代 SDK 任务或队列状态。
- Host 关闭先停止资源观察，再关闭 Harness 使执行取消/归档，最后清理已知 Sandbox 资源。每个子会话的审批文档在官方创建事务内初始化，恢复前连接服务。

真实 HTTP 模型 + Drizzle + Workspace 集成测试验证：子任务权限审批、父历史隔离、Skill 快照、关闭/重开复用子任务、父取消及过期审批拒绝。正常重开不是 SIGKILL 验收；本次不宣称子任务崩溃矩阵完成。

## 剩余 M4

- 正式定时 Task、稳定 occurrence requestId、调度定义编辑/禁用及恢复投影；当前产品仍是旧 ScheduledTaskScheduler。
- 队列编辑/排序/提升语义及崩溃测试。
- 子任务 HTTP/SSE、任务面板和业务运行投影的生产接线及并发上限验收。
- Windows Sandbox 跨进程临时目录回收与新 Run 资源作用域验收。
- 历史只读展示与明确的继续入口，禁止打开旧 JSONL 作为 Durable Storage 或重放历史工具。

## 剩余 M5

- 停止应用后重新备份，验证所有 SQLite 与资源文件，实际演练恢复。
- 完成生产切换后验证桌面/Remote、模型/MCP/Skills、权限、队列、子任务、定时任务、崩溃恢复与历史继续。
- 在上述验收通过后移除旧 Agent/Coding Agent 循环、旧协议和旧依赖，保留历史用户数据。
