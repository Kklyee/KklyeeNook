# Pi Durable M0 兼容性记录

## 结论与范围

M0 SDK 关卡通过：真实 Electron Utility Process 可以打开官方 Node SQLite Storage、创建 Harness、提交并完成输入、关闭、重开，以及重试同一 requestId 而不重复生成。

本阶段不切换产品执行器，不修改 Chat UI，不接入生产 Durable 数据库，不进入 M1。仓库全量门禁仍有下述既有代码和环境阻断，不能宣称全量通过。

## 版本与环境

| 项目 | 实际版本 |
| --- | --- |
| PowerShell | 7.6.6 |
| 本机 Node | 26.7.0 |
| pnpm | 10.33.0 |
| Electron | 39.8.10 |
| Electron 内置 Node | 22.22.1 |
| `@earendil-works/pi-durable` | 1.1.0 |
| `@earendil-works/pi-ai` | 1.1.0 |
| `@earendil-works/chord` | 1.1.0 |
| `@assistant-ui/react` | 0.15.17，未升级 |
| `@assistant-ui/core` | 0.3.17，保留现有 override |
| `typebox` | 1.3.30，保留现有 override |
| `pi-ai-legacy` | `npm:@earendil-works/pi-ai@0.84.4`，过渡别名 |

安装前通过 `pnpm view` 查询，三个新包的最新正式版本均为 1.1.0。根依赖使用确切版本，提交 `pnpm-lock.yaml`，后续阶段不再次浮动安装。网络下载曾超时，最终安装与 postinstall 已成功；现有 patch-package 补丁、TypeBox 打包和 Electron native dependency 检查均完成。

三个新包均为 ESM，Node engines 均要求 `>=22.19.0`，没有声明 peerDependencies。Electron 内置 Node 满足要求。SQLite 适配器使用内置 `node:sqlite`，不引入第三方 SQLite native addon。

## 已核实资料

以安装包文件为编码依据：

- `node_modules/@earendil-works/pi-durable/README.md`、`package.json`、`dist/index.d.ts`。
- `dist/harness/harness.d.ts`、`dist/harness/types.d.ts`、`dist/harness/submissions.d.ts`。
- `dist/storage/sqlite/node.d.ts` 及对应 `node.js`。
- pi-ai、Chord 的 `package.json` exports/engines/dependencies，以及 pi-ai `dist/providers/faux.d.ts`、Chord `dist/context/index.d.ts`。
- assistant-ui 已安装声明中的 `useExternalStoreRuntime`、`ExternalStoreAdapter`、`ExternalStoreThreadListAdapter` 导出。

对应发布标签资料：

- [官方 README](https://github.com/earendil-works/pi/blob/v1.1.0/packages/durable/README.md)
- [14-chat 示例](https://github.com/earendil-works/pi/blob/v1.1.0/packages/durable/test/examples/14-chat.ts)
- [13-recovery 示例](https://github.com/earendil-works/pi/blob/v1.1.0/packages/durable/test/examples/13-recovery.ts)
- [19-json 示例](https://github.com/earendil-works/pi/blob/v1.1.0/packages/durable/test/examples/19-json.ts)
- [设计文档](https://github.com/earendil-works/pi/blob/v1.1.0/packages/durable/docs/spec.md)
- [ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store)
- [ExternalStore API](https://www.assistant-ui.com/docs/api-reference/external-store/runtime)
- [Thread 管理](https://www.assistant-ui.com/docs/runtimes/concepts/threads)

设计文档包含规划和历史表述，不能代替当前安装包声明与执行测试。Durable README 仍明确标记 Experimental。

## 锁定版本的调用契约

| 能力 | 实际 API / 约束 |
| --- | --- |
| SQLite | 从 `@earendil-works/pi-durable/storage/sqlite/node` 导入 `openNodeSqliteStorage(path, options?)` |
| Harness | `Harness.open(storage, { models, registry, settings? }, context)` |
| 根会话 | `harness.root(context, { agent? })`，同一存储重开后保持相同 ID |
| 其它会话 | `harness.createConversation({ ownership, agent?, init? }, context)` |
| 输入 | `conversation.submit({ type: 'input', content, requestId?, whenBusy? }, context)` |
| 接受与完成 | submit 返回 Submission；`submission.wait(context)` 返回 `done` 或 `unanswered`，不能将 submit 返回视为执行完成 |
| 幂等 | 同一 conversation/requestId 返回原 Submission；本阶段已测试完成后跨 reopen 的重试 |
| 调度恢复 | `harness.resume()` 无参数、同步返回 void；submit/wait 等也会启动调度 |
| 关闭 | `harness.close(context)` 关闭调度、Session 和 Storage；不要再并行关闭同一存储 |
| 初始化失败 | Harness.open 失败时由调用方释放已打开的 Storage |
| 历史 | `conversation.entries(query, limit, cursor, context)`；可使用 `order: 'ascending'` |
| 结构视图 | `conversation.viewState(context)` 返回可 dispose 的只读 Chord State；`watch(context)` 返回 watch，需 await stop |
| 事件视图 | `watchEvents(harness, conversationId, context)` 是包级函数，不是猜测的 Harness 方法；返回 snapshot/start/stop |
| Extension 选择 | 不指定时可能选择所有已安装 Extension；产品必须显式限定。本测试 root 的 extensions/tools 均为空 |
| 队列 | whenBusy 的实际拼写为 `steer`、`followUp`、`reject` |
| 终止 | Conversation.abort 与 Submission.abort 是不同操作；取消 Context 等待不会自动取消 Agent 工作 |
| ID | Conversation/Entry/Task/Submission 为独立 branded number；前端 string threadId 需要业务映射 |

## 过渡兼容性

将根 pi-ai 升级到 1.1.0 后，旧 Coding Agent 测试中的消息类型和事件流类不能与其传递依赖 0.84.4 混用。旧模型目录读取也出现 DeepSeek 模型缺失，影响既有模型配置测试。

因此旧代码显式从 `pi-ai-legacy` 使用 0.84.4：

- `src/main/agent/pi/runtime/pi-session-runtime.ts` 的旧 thinking helper。
- `src/main/settings/model-catalog.ts` 的旧模型目录和 thinking helper。
- 四个旧 Pi 测试文件的消息类型与事件流测试工具。

Durable 测试只导入正式名称下的 1.1.0。不对 Pi SDK 设置全局版本 override，不用类型断言掩盖跨版本错误。旧运行时及其模型目录行为保持不变；修改的旧实现和测试按 kebab-case 重命名，调用方只更新引用路径。

`pi-ai-legacy` 不是另一个 Agent 执行器，而是旧运行时的明确 SDK 边界。M5 必须随旧执行代码一起删除。新版本模型目录、Provider、自定义 URL、thinking 和附件能力须在后续实际迁移时分别验证，不能默默沿用旧语义。

现有 TypeBox override 将新 SDK 声明的 1.3.27 解析为 1.3.30，未强制覆盖 Pi SDK 版本。包加载及本阶段模型执行通过；工具 schema、hooks 和真实工具参数校验仍属于 M2 验证范围。

## 正式测试

文件：

- `src/main/agent-backend/testing/engine-smoke.ts`：两次顺序打开同一 SQLite 文件，验证输入答案、稳定 Entry ID、requestId 重试、模型仅调用一次及最终无活跃任务；两个 Harness 均在 finally 中关闭。
- `src/main/agent-backend/engine-smoke.test.ts`：本机 Node 测试，以及真实 `utilityProcess.fork()` 子进程测试。后者使用已安装 TypeScript 转译同一个 fixture，不 mock Electron/Storage/Harness。

使用官方 Faux Provider，不发送网络请求，不读取用户凭据，不调用业务工具。测试生成的入口和 SQLite 文件在 finally 中删除；测试后没有遗留 `.nook-durable-*` 目录。不使用 MemoryStorage，不触碰旧 Session 文件或应用数据库。

无 sections、tools 的最小会话只有 user/assistant 两条 Entry，不应假设始终有第三条 system Entry。

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run src/main/agent-backend/engine-smoke.test.ts` | 2/2 通过 |
| `pnpm exec vitest run src/main/agent-backend src/main/agent/pi src/main/settings src/main/remote --maxWorkers=2` | 33 文件、135 测试通过 |
| `pnpm run typecheck:node` | 通过 |
| `pnpm run typecheck:remote` | 通过 |
| 相关文件的 `pnpm exec oxlint` | 通过 |
| `pnpm test` 首次高并发回归 | 410 通过、36 失败、2 跳过；包含随后已修复的 SDK 混用和并发超时 |
| `pnpm test --maxWorkers=2` 修复后回归 | 416 通过、30 失败、2 跳过；86 文件通过，Sandbox 文件失败，并有 1 个未处理拒绝 |
| `pnpm run typecheck` | Node 通过；Web 被既有 TS6133 阻断 |
| `pnpm run lint` | 被同一既有未使用参数阻断 |
| `pnpm run build` | Remote 构建通过；后续 Web typecheck 阻断，未到桌面打包 |

仓库门禁阻断：

1. `packages/ui/src/assistant-ui/thread-list-row.tsx:15` 的 `updatedAt` 未使用。通过 `git show HEAD:...` 确认本次改动前已存在；不为 M0 顺便修改 UI。
2. Windows Sandbox 不能打开 `\\?\GLOBALROOT\Device\Null`，报拒绝访问 / `sandbox_policy_init_failed`，导致 30 个测试失败及一个未处理拒绝。需要按现有 Sandbox 流程处理管理员设备权限，不能删除测试、降低权限或用 full-access 绕过。M0 未修改 Sandbox 实现。
3. 首轮高并发中的知识和历史迁移超时，在降低并发后通过；未增加全局 timeout 或掩盖这些测试。

## 后续关卡

M0 仅证明锁定 SDK 的环境兼容性。尚未证明：杀进程后的未完成任务恢复、并发提交、busy/steer/withdraw、cancel、SSE snapshot/reset、审批恢复、危险副作用安全、业务 ID 映射或历史迁移。

M1 前需备份实际业务数据库、旧 Session、任务记录及重要资源索引，备份不得进入 Git。本阶段仅运行隔离测试，未启动新产品持久化流程。M1 还需落实唯一宿主和生命周期；M2 不能把 beforeTool 或 renderer Promise 假定为可恢复审批。

官方 SQLite 默认 WAL + synchronous=NORMAL，进程崩溃与断电保障不同；最新提交可能在断电/宿主故障时丢失。同一 Storage 只允许一个进程拥有，SDK 无跨进程锁。Smoke 的两次打开严格顺序，不证明产品单实例约束已落实。

assistant-ui 现有版本已经导出 ExternalStoreRuntime 及同步 Thread List Adapter，本阶段无需升级。M3 再迁移 Store/Client/Event Projection，保留现有 Elements 和 UI，不叠加第二个 Thread List Runtime。
