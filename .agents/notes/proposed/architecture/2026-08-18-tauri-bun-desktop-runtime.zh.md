# Agent Note: Tauri Bun desktop runtime

Status: proposed

[English](2026-08-18-tauri-bun-desktop-runtime.md) | 中文

## Problem

DeepSeek Harness 从 pnpm 安装的包图动态组合并启动 Cordis Host。这种开发与 CLI 发行模型无法生成在干净机器上直接启动的桌面应用：用户必须提供兼容的 JavaScript runtime 与包管理器，Web shell 缺少 Host 就不能运行，原生 addon 需要按目标平台安装，且没有一个桌面 supervisor 统一拥有进程树关闭。

桌面构建必须保留 Cordis 插件生命周期、Harness policy、loopback API、客户端插件 bundle、profile patch 热更新与 Bash 行为。直接在 WebView 中加载 `apps/web/dist`，或把 Host service 改成模型可见的 Tauri command，都会绕过这些属性。

## Proposal

交付一个 Tauri 2 应用，由 Rust 进程监管以 Bun standalone compile 生成的 DSH Host sidecar。Host 只绑定 OS 分配的 loopback 端口，输出结构化 readiness record，并向 WebView 提供现有的、经过变换的 Web 应用。每次启动使用独立 secret 认证 WebView session。安装后的应用不要求 Node、Bun、pnpm 或仓库 checkout。

桌面 backend 接收显式 resource root 与 user-data root。内置 Cordis 插件通过生成的 deployment manifest 解析，而不是依赖 pnpm workspace。客户端 bundle、frontend asset、profile template、prompt 与 license 作为外部签名资源保留，使 URL 服务与更新不依赖 Bun executable 内部路径。用户插件位于专用 data directory；Host 加载前必须通过安装、完整性、native code 与 capability policy。

Tauri 首先以 sidecar 方式监管 Bun 进程，而不把 runtime 嵌入 GUI 进程。崩溃、日志、重启策略、升级和强制进程树清理因而具有明确的操作系统进程边界。

## Shipped checkpoint

首个 checkpoint 增加 `apps/desktop`：Tauri 使用 Bun 启动 `apps/desktop/backend/dev.ts`，等待现有动态端口 readiness 行，并把 WebView 导航到真实 Host origin。Rust 拥有 child handle，并在应用退出时强制清理 Windows 进程树。Desktop backend 可以显式禁用 boot 后配置 watcher，因为 Bun 无法访问该 service 所需的 Node internal module loader；客户端插件 SSE HMR 仍属于 Web profile。

Bun 1.3.14 还无法解析此 graph 中的可选 pi-ai adapter，也不提供 Node `stripTypeScriptTypes`，其 source loader 不能解析 auto directory picker 的 opaque client package。Development overlay 禁用前两个 row，并直接挂载 browse Host provider。Koffi 的 Windows N-API finalizer 也会使 Bun 崩溃，因此 checkout checkpoint 为受影响的 namespace 操作选择显式 filesystem fallback，而其 release 实现仍计划迁移到 Rust。这些限制是明确可见的 checkpoint constraint，不是 release compatibility claim。

该 checkpoint 现在包含 Windows persistent terminal 的第一个 Phase 3 slice。Desktop subprocess adapter 不加载 `node-pty`；它连接到 Tauri 进程中每次启动认证的 Rust service。Rust 创建 ConPTY、启动 Git Bash、传输输入输出、处理 resize 与 Ctrl-C、终止 terminal，并通过既有 `ctx.subprocess.spawnTerminal()` contract 报告退出。真实 Windows integration test 会通过这条路径写入命令，既有 minimal-preset session 也已通过手工验收。Job Object 归属与 release-grade 进程树语义仍未完成。

## Delivery phases

### Phase 0: compatibility baseline

为真实 desktop entry path 增加可重复的 Bun compatibility gate。它记录 Bun 版本，并验证 CLI parsing、Host 使用的 ESM 与 Node builtin、动态 Cordis loading、Web profile boot、native dependency loading、clean shutdown 与 Bun standalone compilation。每个失败都归类为 packaging defect、Bun compatibility defect，或需要以 Rust 替换的平台组件。

Bun 1.3.14 上的初始 Windows probe 确立了四个事实：TypeScript CLI 及其 help path 可以直接在 Bun 下运行；直接 standalone compile 会失败，因为 `apps/cli/src/bin.ts` 相对 Bun virtual executable filesystem 读取 `package.json`；Koffi 的 N-API finalizer 会使 Host 崩溃；`node-pty` 可以显示初始 ConPTY 输出，但报告 pid zero，并在首次写入时关闭 input socket。后两项是 Rust 替换输入，不是可接受的桌面行为。

### Phase 1: deterministic Bun backend

增加桌面专用 backend entry、deployment-manifest generator、resource locator 与结构化 stdout control protocol。生成无需仓库相对 package lookup 即可启动 shipped Web profile 的 standalone target executable。普通日志写 stderr；stdout 只输出带版本的 JSON readiness 与 terminal record。

Backend 支持 controlled shutdown，并可脱离 Tauri 独立运行，以便单独测试生命周期与 closure。

### Phase 2: Tauri 2 supervisor

增加带 bootstrap page 与 Rust supervisor 的 `apps/desktop`。它生成 launch secret，以 `127.0.0.1:0` 启动目标平台 backend，在 deadline 内等待 readiness，只导航到返回的 origin，把外部链接交给系统浏览器，并在应用退出时达到 process-tree quiescence。启动失败时显示本地 diagnostic page 并保留 backend log。

### Phase 3: Rust platform services

在现有 DSH capability seam 后替换 native-addon 与 runtime-sensitive Host mechanics。第一个 Windows terminal slice 已实现：desktop `ctx.subprocess.spawnTerminal()` 选择经过认证的私有 Rust transport，Rust 拥有 ConPTY 与 Git Bash，既有 terminal consumer 保留 readiness 与 policy。其余 service closure 包括 pipe process、output limit、spill file、带版本 IPC、backpressure、Windows Job Object、完整后代核算、严格 signal 语义、断线 teardown 与 awaited tree termination。`dsh-shell`、terminal consumer、sandbox policy 与模型可见 tool 保持现有 interface。

目标平台需要时，把 sandbox execution primitive 移到 Rust，但 Cordis policy 与 approval 仍是权威决策者。只有受支持 Bun target 无法提供可复现的 `sharp` closure 时才替换图片处理；兼容要求是 attachment behavior，而不是特定 library。

### Phase 4: plugin and release closure

为每个 target 生成并验证一个 runtime closure。内置插件是 immutable application resource。插件安装器使用 staged download、integrity verification、capability declaration、per-plugin lock、atomic publication、rollback 与显式 native-code policy；它不要求系统 pnpm。开发目录继续支持 client-plugin HMR，安装插件则使用签名或完整性固定的 bundle。

构建并测试 Windows x64、macOS x64/arm64 与 Linux x64 artifact。签名、notarization、updater metadata、非 ASCII 安装路径、clean-machine startup、uninstall behavior 与 third-party notice 是 release input，而不是构建后的手工步骤。

## Stable boundaries

WebView 始终加载 Host 的 loopback origin；`file://` 不是应用 transport。Cordis 继续拥有插件与 service lifecycle。Harness policy 与 approval 继续拥有授权决策。Rust provider 执行已经解析的 plan，但不制定 policy。Rust IPC method 不作为额外模型 tool 暴露。

Backend control protocol 带版本且可机器解析。只有完整 Cordis tree 与 API route settle 后才输出 readiness。关闭时先请求 Cordis dispose，等待 managed work，然后在 deadline 后由 Rust supervisor 强制结束所拥有的进程树。

Release artifact 不包含 Node executable，运行时也不依赖 Node、Bun、pnpm、npm 或全局 `dsh`。仓库开发仍可在现有构建工具要求时使用 pnpm 与 Node。

## Alternatives considered

**携带 Node 与 pnpm production closure。** 这会保留当前受支持 runtime，但也会保留庞大且依赖目录布局的 deployment，且不能解决无包管理器插件安装与 native process ownership。

**由 Tauri 直接提供 `apps/web/dist`。** 静态 shell 缺少 runtime boot injection、API route、plugin bundle、SSE、profile composition 与 Host policy，因此这会创建第二套应用，而不是打包 DSH。

**立即把 Bun 嵌入 Tauri GUI 进程。** Sidecar 为失败、teardown、日志、升级与插件隔离提供更清晰的进程生命周期。只有 standalone backend 与插件失败模式得到验证后才考虑嵌入。

**用 Rust 重写整个 Host。** Cordis composition 与现有插件生态是产品能力。Rust 在 capability seam 后替换平台敏感 provider，而不是替换 Host 并使插件失效。

**永久保留 native addon。** 只有 Bun compatibility 不能保证可复现的跨平台安装或进程树语义。关键 process 与 sandbox service 移到 Rust；只有 target-matrix test 证明 closure 可确定，且 Rust 替换不会改善 ownership 或 distribution 时，native dependency 才保留。

## Acceptance criteria

- 干净目标机器无需 Node、Bun、pnpm、npm、Git 或仓库 checkout 即可启动已签名桌面应用。
- 完整 Host ready 后，WebView 才连接动态分配且经过认证的 loopback origin。
- Shipped Cordis plugin、API call、SSE、client bundle、profile patch reload、Bash、approval 与 Harness policy 的行为与 Web profile 一致。
- 任一进程关闭或崩溃后，不残留 backend、shell、PTY、agent 或 sandbox descendant。
- Bun backend 与 Rust IPC protocol 具有带版本的 integration test，覆盖 startup failure、malformed record、timeout、cancellation 与 forced teardown。
- 每个 release target 从生成的 closed manifest 构建，并通过 clean-machine、native-service、signing、update 与 non-ASCII-path test。
- 用户插件安装是 transactional 且受 policy 控制，并且绝不调用系统 package manager。

## Risks

Bun standalone compilation 可能无法保留所有动态 module behavior；生成的 built-in manifest 有意以任意 package lookup 换取封闭 shipped graph。因此用户插件需要独立的外部加载与安装设计。

把 subprocess、PTY 与 sandbox mechanics 移到 Rust 会引入 IPC protocol 与跨语言生命周期测试。只有实现准确保留 output、cancellation、termination 与 policy semantics 时，才能获得可确定的 native distribution。

Tauri 与 backend 会为每个 target 产生两个 release artifact。它们的 protocol 与 resource-manifest version 不匹配时必须 fail loud，updater 必须原子发布二者。
