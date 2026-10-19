# Jouzu flow-control UI —— 代码在哪、是什么、为什么废弃

> 交接文档，写给要在别的机器上接手这块的人。
> 一句话：**这段 UI 已经被删除，只能从 git 历史里看。** 删除是刻意的，先读完第 3 节再决定要不要复活。

---

## 1. 去哪里看代码

```bash
git clone https://github.com/sabishii-me/deepseek-harness.git
cd deepseek-harness
git checkout feat/jouzu-harness-backend
```

**这个分支的 HEAD 上已经没有这些文件了**（它们被删掉了）。要看内容用提交号取：

```bash
# 整套 UI 的原始版本（推荐从这里开始）
git show 1df59f31e0:packages/experimental/jouzu-ui/src/client/Flow.tsx
git show 1df59f31e0:packages/experimental/jouzu-ui/src/client/Panel.tsx
git show 1df59f31e0:packages/experimental/jouzu-ui/src/client/LiveProgress.tsx
git show 1df59f31e0:packages/experimental/jouzu-ui/src/client/TaskList.tsx
git show 1df59f31e0:packages/experimental/jouzu-ui/src/client/Tool.tsx
git show 1df59f31e0:packages/experimental/jouzu-ui/src/client/ActivityRow.tsx

# 列出这个包的全部 26 个文件
git ls-tree -r --name-only 1df59f31e0 -- packages/experimental/jouzu-ui/

# 把整个包导出到本地目录
git archive 1df59f31e0 packages/experimental/jouzu-ui | tar -x
```

| 关键提交 | 含义 |
|---|---|
| `1df59f31e0` | 引入（`feat(experimental): add the Jouzu and shisa integration packages`） |
| `b87c764250` | **删除**（`retire the agent-loop-replacing Jouzu route`） |

两个提交都配有完整说明，`git log -1 --format=%B <sha>` 可读。

---

## 2. 这套 UI 是什么

它把 Jouzu 原生 CLI 的**结构化报告**渲染到 DSH 的会话界面里，而不是把原始 JSON 丢给用户。

| 文件 | 职责 |
|---|---|
| `Flow.tsx` | **核心。** `FlowReport` 解析 Jouzu 的 `kind` 信封：`result` / `work` / `alert` / `wait`，各渲染成结构化区块；无法识别的输出退化为纯文本。这是「flow control」的展示层 |
| `Panel.tsx` | 用 DSH 原生 Todo dock 的样式展示「凭据支撑的工作项」 |
| `LiveProgress.tsx` | 在既有 DSH Chat 快照之上做实时反馈（**不引入第二条事件流**） |
| `TaskList.tsx` | 原生 Todo 与外部后端共用的任务列表（纯展示） |
| `Tool.tsx` | 把 Jouzu 原生工具渲染进既有的 keyed tool-call 槽位 |
| `ActivityRow.tsx` | 上面几个共用的行组件 |

**设计取向值得注意**：它全部复用 DSH 既有槽位与快照，不新开通道；文案在 `locales.ts`，组件里不留产品字面量。

---

## 3. 为什么被删除（重要）

`b87c764250` 的原文理由：

> The Jouzu execution route mounted its own Agent factory and disabled the official
> agent-loop, which is exactly the shape this project rules out. It was never
> activated (no patch referenced it) and is superseded by `dsh-tauri-kernel`'s adapter.

拆开说：

1. **它配套的后端替换了 DSH 的 agent factory 并禁用了官方 agent-loop。** 这个项目的硬规则是「不替换、不禁用官方 agent-loop」，所以这条路线整体被否。
2. **它从未被激活过** —— 没有任何 patch 引用它。
3. **已被 `dsh-tauri-kernel` 的 adapter 取代。**

**注意：`dsh-tauri-kernel` 的版本只实现了执行侧（一个会话一个子进程、JSON 行协议、投影到官方 `NativeSink`），没有移植这套 flow-control UI。**
所以如果你现在找「Jouzu 的 Flow/任务面板长什么样」，答案就是这份被删掉的代码。

---

## 4. 现在 Jouzu 集成在哪里

| 位置 | 内容 |
|---|---|
| `sabishii-me/deepseek-harness-desktop`，分支 `feat/jouzu-kernel` | 桌面壳层 + `packages/dsh-tauri-kernel`（原生内核 adapter） |
| `sabishii-me/dsh-jouzu-bridge` | loopback 模型传输 + Pi 扩展（从被删的那套里保留下来的两块） |
| `sabishii-me/dsh-model-provider-shisa` | Shisa 模型提供商 |

桌面侧的整体改动说明见那个仓库的 `docs/FORK-CHANGES.md`。

---

## 5. 如果要把这套 UI 复活

先想清楚一件事：**它的宿主（`jouzu-backend`，那个替换 agent-loop 的路由）是被明令禁止的，但 UI 组件本身只是「把结构化文本渲染得好看」**，不依赖那个路由。

也就是说：

- `Flow.tsx` / `TaskList.tsx` / `ActivityRow.tsx` 是**纯展示**，可以移植到 `dsh-tauri-kernel` 的工具结果渲染路径上
- `Panel.tsx` / `LiveProgress.tsx` 依赖 Jouzu 后端的投影类型（`dsh-experimental-jouzu-backend/ui-types`），**不能直接搬**，要按新内核的事件模型重写

**迁移前请先确认**：新内核（`dsh-tauri-kernel`）是否把等价的结构化信息投影出来了。如果它只投影成普通文本，先补投影，再谈 UI。
