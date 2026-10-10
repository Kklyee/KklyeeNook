# Pi Durable M1 后台基础

## 状态

持久宿主与 ConversationService 基础已实现并通过测试；尚未接入正式 bootstrap/Hono 产品请求。本阶段不宣称 M1–M5 全部完成，不切换 Chat，也不删除旧执行器。

正式宿主接线需要先完成 M2 的 Provider、工具、权限和可恢复审批注册，避免启动一个能力不完整的生产执行器。当前只有独立集成测试调用新引擎，不存在一段产品执行由两个 owner 同时驱动。

## 实现

- `src/main/agent/agent-engine.ts`：一个 Harness、官方 Node SQLite Storage、resume、关闭与事件订阅释放。
- `src/main/agent/conversation-service.ts`：复用现有 AgentSessionRepo 业务元数据，不创建第二套 Run 状态引擎。
- `src/main/agent/agent-engine.test.ts`：服务、Storage、所有权和真实进程崩溃恢复测试。
- 现有 Electron Smoke 现在通过 AgentEngine 打开 Harness，并检查重复宿主被拒绝。

### 单实例所有权

打开 Durable 数据库前，对独立 `${databasePath}.owner.sqlite` 连接持有 `BEGIN EXCLUSIVE`。未取得锁的调用不打开 Durable Storage；同进程和跨进程重复宿主都会被 SQLite 拒绝。锁依赖操作系统文件锁，不使用 PID 文件判断或删锁重试。关闭宿主释放锁，进程被杀后操作系统释放锁。owner 文件不得在宿主运行时删除。

正式路径应由 Agent Backend 固定在用户数据目录 `agent-durable.sqlite`，main/renderer/remote 不自行打开 Storage。此生产路径与生命周期接线仍待后续实现。

### ID 映射与创建发布

Session 文档 `nook.thread-links` 将产品 string threadId 映射到 branded number conversationId。在同一 Durable commit 中创建 Conversation、配置允许的 Agent 能力、保存初始元数据 `nook.conversation-created` 并写入映射。

创建后才通过原业务 Repository 发布会话记录。若业务保存失败，列表和 get 不暴露半创建会话；用相同 threadId 重试或重启后重试会复用原 Conversation 和原创建元数据。重试不会偷偷更换初始标题、Workspace 或权限。初始快照仅用于创建发布恢复；后续产品元数据由业务数据库管理，不参与判断执行状态。

原数据库中没有 Durable 映射的旧会话不被 create 覆写，返回只读历史错误。旧历史列表与继续语义仍需 M4 处理。

默认 extensions/tools 都为空。未经过 M2 校验不能将宿主安装的全部工具自动开放。创建失败的 init 与映射一起回滚。

### 提交与取消

submit 要求非空稳定 requestId，仅返回 accepted/conversationId/submissionId；完成状态通过 Durable Submission 读取。status/withdraw 校验 Submission 属于当前 Conversation，防止跨线程操作。

cancel 使用 Conversation.abort；withdraw 使用 Submission.abort，两者不混同。snapshot 直接使用官方 watchEvents 的权威 snapshot，含 run/generation/tools/inbox，不从连接状态或业务 Run 表推断结束。

关闭拒绝新入口，释放 watch 后关闭 Harness，最后释放 owner。重复 close 返回同一个 Promise。发生异常时使用未取消的 Context 完成资源释放。

## 验证

七个新增测试全部通过：

1. 并发创建同一 threadId、并发相同 requestId、生成完成、重开保持映射与唯一输入。
2. 业务元数据发布失败不可见，重开重试保留最初元数据，不覆写旧历史。
3. 模型失败保持 `unanswered`，拒绝跨 Conversation 撤回。
4. 正在生成时排队、撤回单条队列、取消当前执行，关闭 event watch。
5. 创建 init 失败回滚，关闭后拒绝入口。
6. 拒绝第二个宿主，正常关闭后重新取得锁。
7. 真实 Node 子进程在已提交流式进度后被 SIGKILL；恢复进程取得锁、resume 并完成原 Submission，用户输入仍只有一条，Conversation/Submission ID 不变。

SQLite 持久化不是 MemoryStorage。服务测试的业务 Repository 使用真实 Drizzle/libsql 内存数据库；业务文件的既有实现未改变。崩溃测试和所有 Durable 测试均使用独立磁盘数据库。测试入口、数据库和调试文件已清理。

- 新增核心测试与 Electron Smoke：9/9 通过。
- 后台、旧 Pi、Settings、Remote 加上新增核心测试：34 文件、142 测试通过。
- `pnpm run typecheck:node`：通过。
- 新增/修改文件的 oxlint：通过。
- 全仓 UI unused-parameter 与 Sandbox 管理员设备权限问题仍按 M0 记录，不能声称全仓门禁通过。

Electron Utility Process 测试使用实际 Electron 39.8.10 / Node 22.22.1，不是 mock。真实进程崩溃测试目前使用本机 Node；正式 Agent Backend 崩溃后 Hono/客户端恢复仍属后续接线验收。

## 备份

实施前备份位于 Git 外的本机 `%LOCALAPPDATA%/KKlyeeNook/migration-backups/20261010-135621`：

- 开发工作区和应用用户目录的五个 SQLite 数据库，包括任务、历史和资源索引。
- 工作区 sessions、应用 pi-sessions、tool-results。
- 共 96 文件、117459475 bytes；五个数据库均通过 `PRAGMA integrity_check`。

SQLite 使用内置 backup API 获取一致备份，不把 WAL 数据库直接复制成不完整快照。资源目录为文件复制，未声称与所有外部写入原子一致；正式历史迁移前还须在应用停机后重新备份并做恢复演练。未备份凭据到 Git，也未修改真实用户会话或业务数据库 Schema。

## 未完成与下一步

- M1 生产 bootstrap/Hono 接线、实际模型配置与应用单实例启动流程。
- M2 工具/权限、审批持久化与重启验证、Prompt/Skills/AGENTS.md、MCP 动态状态。
- M3 ExternalStoreRuntime/ChatStore/Client/SSE 与现有 UI 的完整迁移。
- M4 队列语义、Scheduler/Subagent、历史只读与继续协议。
- M5 全量运行验收后清理旧代码、Pi 依赖与临时 legacy 别名。

不会以这些后台测试代替产品运行验收，也不会提前删除旧代码和旧数据。
