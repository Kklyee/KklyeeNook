# KklyeeNook

Electron、React、TypeScript 桌面 Agent。

## 开发

```sh
npm install
npm run dev
```

验证：`npm test`、`npm run lint`、`npm run build`。Windows 打包：`npm run build:win`。

## Knowledge

在 Settings → Knowledge 中添加文档、文件夹或当前 Workspace，也可以拖入文件。支持 PDF、DOCX、PPTX、XLSX、HTML、Markdown、TXT 和代码文件。来源显示文档数、chunk 数、索引状态、最后索引时间及 embedding 模型，可重新索引或移除。

第一次索引会下载本地多语言 embedding 模型和中英文 OCR 数据；第一次检索会下载 rerank 模型。下载完成后在 CPU 上本地运行，缓存保存在应用用户数据目录的 `knowledge-cache` 中。需要通过代理联网时，支持 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。

默认模型为 `Xenova/paraphrase-multilingual-MiniLM-L12-v2` 和 `Xenova/bge-reranker-base`。Knowledge 设置可以更换为 Transformers.js 支持的 ONNX 模型；更换 embedding 模型后需要重新索引已有来源。

文件夹和 Workspace 每 30 秒检查一次内容 hash，仅处理新增、修改和删除的文件，跳过依赖和构建目录。失败的来源显示具体原因，可点击 Reindex 重试。移除来源仅删除索引。

主 Agent 和 Subagent 通过 `search_knowledge` 执行 BM25 + 向量检索、RRF 融合和神经 rerank，再通过 `read_knowledge` 读取 parent context。聊天中的来源引用可打开上下文和原文件，保留 PDF 页码、章节和代码行号。Knowledge 页面也提供检索入口。

## 解析与存储

复杂文档使用 `officeparser` AST，文本和代码使用独立 parser，统一转换为项目自己的 `ParsedDocument`。项目负责章节切分、parent/child chunks 和上下文前缀，避免依赖第三方 chunk 格式。PDF 和 Office 图片使用 Tesseract.js OCR，整个链路使用 Node/TypeScript。

主数据库保存 source/document metadata；同目录的 `knowledge.db` 保存 chunks、FTS5 和 embedding。V1 使用 libSQL 的精确向量距离查询。

`officeparser` 固定为 8.1.0，通过 `patch-package` 修复部分配置未合并默认值、OCR worker 错误处理及 OCR 缓存路径。安装依赖时自动应用 `patches/officeparser+8.1.0.patch`。
