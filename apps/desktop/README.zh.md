# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

由 Bun 承载 DSH Web profile 的 Tauri 2 开发 supervisor。它在 OS 分配的 loopback 端口上启动 checkout backend，等待现有 `dsh web:` readiness 行，然后把 WebView 导航到完整 Host 应用，而不是通过 `file://` 加载 `apps/web/dist`。

## 开发 checkpoint

前置条件为 Bun 1.3.14 或更新版本、Rust、当前平台的 Tauri 前置组件和仓库依赖。在仓库根目录运行：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @deepseek-ai/dsh-desktop run prepare:dev
corepack pnpm --filter @deepseek-ai/dsh-desktop tauri dev
```

首次构建后，只运行最后一条命令即可使用既有 artifact 重启 Tauri。修改 Host 或 Web artifact 后运行 `corepack pnpm run build`；`pnpm run dev:web` 可以与 Tauri 同时运行，以提供客户端插件 bundle HMR。

这个 checkpoint 使用已安装的 Bun command 运行 `apps/desktop/backend/dev.ts`。它还不是 release closure，也不生成自包含 installer。Bun 1.3.14 无法加载可选 pi-ai adapter、使用 Node `stripTypeScriptTypes` 的 code-runtime provider 和使用 Node internal API 的配置 HMR service，因此 desktop development overlay 禁用这些行，并固定 browse directory-picker Host provider。客户端插件 SSE HMR 仍保持挂载。Bun 1.3.14 还会在 Koffi 的 Windows finalizer 中崩溃，因此这个 checkout checkpoint 会为受影响的持久 namespace 操作选择显式 filesystem fallback；release build 必须把这些操作迁移到 Rust 后方，且不得削弱其持久性约定。

Desktop 部署中的 Windows persistent Bash 不使用 `node-pty`。Tauri 进程启动每次启动认证的 loopback terminal service，拥有 ConPTY 与 Git Bash，并通过既有 `ctx.subprocess.spawnTerminal()` seam 提供 terminal 输入、输出、resize、Ctrl-C、终止和退出事实。Harness policy、approval、sandbox resolution、terminal readiness 与模型可见 Bash 约定仍位于 Cordis。

## 模型体验

Desktop supervisor 不增加模型可见文本或工具。Session 使用 Web profile 现有的 prompt、Cordis plugin graph、Bash tool、approval 与 Harness policy。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

当前 checkpoint 仍解析面向人的 backend readiness 行，没有经过认证的 WebView HTTP session，并在退出时直接强制清理 backend 进程树，而不是先使用私有 shutdown protocol。Rust terminal channel 已认证，但其 protocol 尚未版本化，Windows 实现仍需要 Job Object 归属、完整后代核算、严格 signal 语义、backpressure 和断线 teardown 覆盖。Navigation 与 external-link 限制、结构化 control record、其余 Rust process service、确定性 deployment manifest 和签名 installer 由 proposed [desktop runtime architecture](../../.agents/notes/proposed/architecture/2026-08-18-tauri-bun-desktop-runtime.md)负责。
