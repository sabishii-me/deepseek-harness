# Agent Note: Tauri Bun desktop runtime

Status: proposed

English | [中文](2026-08-18-tauri-bun-desktop-runtime.zh.md)

## Problem

DeepSeek Harness boots a dynamically composed Cordis host from a pnpm-installed package graph. That development and CLI distribution model does not produce a desktop application that starts on a clean machine: the user must supply a compatible JavaScript runtime and package manager, the Web shell cannot run without the Host, native addons need target-specific installation, and process-tree shutdown is not owned by one desktop supervisor.

A desktop build must preserve the Cordis plugin lifecycle, Harness policy, loopback API, client-plugin bundles, profile patch reload, and Bash behavior. Loading `apps/web/dist` directly in a WebView or replacing Host services with model-visible Tauri commands would bypass those properties.

## Proposal

Ship a Tauri 2 application whose Rust process supervises a standalone Bun-compiled DSH Host sidecar. The Host binds only an OS-assigned loopback port, emits a structured readiness record, and serves the existing transformed Web application to the WebView. A per-launch secret authenticates the WebView session. The installed application requires neither Node, Bun, pnpm, nor a repository checkout.

The desktop backend receives an explicit resource root and user-data root. Built-in Cordis plugins resolve through a generated deployment manifest rather than a pnpm workspace. Client bundles, frontend assets, profile templates, prompts, and licenses remain external signed resources so URL serving and updates do not depend on paths inside the Bun executable. User plugins live in a dedicated data directory and pass installation, integrity, native-code, and capability policy before the Host loads them.

Tauri initially supervises the Bun process as a sidecar rather than embedding the runtime in the GUI process. Crashes, logs, restart policy, upgrades, and forced process-tree cleanup therefore have an explicit operating-system process boundary.

## Shipped checkpoint

The first checkpoint adds `apps/desktop`: Tauri starts `apps/desktop/backend/dev.ts` with Bun, waits for the existing dynamic-port readiness line, and navigates its WebView to the real Host origin. Rust owns the child handle and force-cleans the Windows process tree on application exit. The desktop backend can disable post-boot config watching explicitly because Bun cannot access the Node-internal module loader required by that service; client-plugin SSE HMR remains part of the Web profile.

Bun 1.3.14 also cannot parse the optional pi-ai adapter in this graph or provide Node's `stripTypeScriptTypes`, and its source loader cannot resolve the auto directory picker's opaque client package. The development overlay disables the first two rows and mounts the browse Host provider directly. Koffi's Windows N-API finalizer also crashes Bun, so the checkout checkpoint selects explicit filesystem fallbacks for affected namespace operations while their release implementation remains assigned to Rust. These limitations are visible checkpoint constraints, not release compatibility claims.

The checkpoint now includes the first Phase 3 slice for Windows persistent terminals. The desktop subprocess adapter does not load `node-pty`; it connects to a per-launch authenticated Rust service in the Tauri process. Rust creates ConPTY, starts Git Bash, transports input and output, handles resize and Ctrl-C, terminates the terminal, and reports exit through the existing `ctx.subprocess.spawnTerminal()` contract. A real Windows integration test writes a command through this path, and an existing minimal-preset session has passed manual acceptance. Job Object ownership and release-grade process-tree semantics remain open.

## Delivery phases

### Phase 0: compatibility baseline

Add a repeatable Bun compatibility gate for the real desktop entry path. It records the Bun version and verifies CLI parsing, ESM and Node built-ins used by the Host, dynamic Cordis loading, Web profile boot, native dependency loading, clean shutdown, and Bun standalone compilation. Every failure is classified as a packaging defect, a Bun compatibility defect, or a platform component to replace in Rust.

The initial Windows probe on Bun 1.3.14 establishes four facts: the TypeScript CLI and its help path run directly under Bun; a naive standalone compilation fails because `apps/cli/src/bin.ts` reads `package.json` relative to Bun's virtual executable filesystem; Koffi's N-API finalizer crashes the Host; and `node-pty` can display initial ConPTY output but reports pid zero and closes its input socket on the first write. The latter two are Rust replacement inputs, not accepted desktop behavior.

### Phase 1: deterministic Bun backend

Introduce a desktop-specific backend entry, deployment-manifest generator, resource locator, and structured stdout control protocol. Produce a standalone target executable that boots the shipped Web profile without repository-relative package lookup. Preserve ordinary stderr logs and reserve stdout for versioned JSON readiness and terminal records.

The backend supports controlled shutdown and remains runnable without Tauri so its lifecycle and closure can be tested independently.

### Phase 2: Tauri 2 supervisor

Add `apps/desktop` with a bootstrap page and a Rust supervisor. It generates a launch secret, starts the target-specific backend with `127.0.0.1:0`, waits with a deadline for readiness, navigates only to the returned origin, opens external links in the system browser, and reaches process-tree quiescence on application exit. Startup failures render a local diagnostic page and retain backend logs.

### Phase 3: Rust platform services

Replace native-addon and runtime-sensitive host mechanics behind existing DSH capability seams. The first Windows terminal slice is implemented: desktop `ctx.subprocess.spawnTerminal()` selects a private authenticated Rust transport, Rust owns ConPTY and Git Bash, and the existing terminal consumer retains readiness and policy. The remaining service closure includes pipe processes, output limits, spill files, versioned IPC, backpressure, Windows Job Objects, complete descendant accounting, strict signal semantics, disconnect teardown, and awaited tree termination. `dsh-shell`, terminal consumers, sandbox policy, and model-facing tools keep their existing interfaces.

Move sandbox execution primitives to Rust where the target platform requires it, while Cordis policy and approval remain authoritative. Replace image processing only if the supported Bun target cannot provide a reproducible `sharp` closure; attachment behavior, not a specific library, is the compatibility requirement.

### Phase 4: plugin and release closure

Generate and verify one runtime closure per target. Built-in plugins are immutable application resources. The plugin installer uses staged download, integrity verification, capability declarations, a per-plugin lock, atomic publication, rollback, and an explicit native-code policy; it never requires system pnpm. Client-plugin HMR remains available for development directories, while installed plugins use signed or integrity-pinned bundles.

Build and test Windows x64, macOS x64/arm64, and Linux x64 artifacts. Signing, notarization, updater metadata, non-ASCII installation paths, clean-machine startup, uninstall behavior, and third-party notices are release inputs rather than post-build manual steps.

## Stable boundaries

The WebView always loads the Host's loopback origin; `file://` is not an application transport. Cordis remains the plugin and service lifecycle owner. Harness policy and approval remain the authorization owner. Rust providers execute resolved plans but do not make policy decisions. No Rust IPC method is exposed as an additional model tool.

The backend control protocol is versioned and machine-readable. Readiness is emitted only after the complete Cordis tree and API routes settle. Shutdown first asks Cordis to dispose, waits for managed work, and then lets the Rust supervisor force the owned process tree after a deadline.

The release artifact contains no Node executable and has no runtime dependency on Node, Bun, pnpm, npm, or a global `dsh` installation. Repository development may continue to use pnpm and Node where existing build tooling requires them.

## Alternatives considered

**Bundle Node and the pnpm production closure.** This preserves the currently supported runtime but retains a large, layout-sensitive deployment and does not address package-manager-free plugin installation or native process ownership.

**Serve `apps/web/dist` directly from Tauri.** The static shell lacks runtime boot injection, API routes, plugin bundles, SSE, profile composition, and Host policy, so this would create a second application rather than package DSH.

**Embed Bun in the Tauri GUI process immediately.** A sidecar gives failures, teardown, logging, upgrades, and plugin isolation a clearer process lifecycle. Embedding remains possible only after the standalone backend and plugin failure modes are proven.

**Rewrite the whole Host in Rust.** Cordis composition and the existing plugin ecosystem are product capabilities. Rust replaces platform-sensitive providers behind their seams instead of replacing the Host and invalidating plugins.

**Keep native addons indefinitely.** Bun compatibility alone would not guarantee reproducible cross-platform installation or process-tree semantics. Critical process and sandbox services move to Rust; a native dependency stays only when target-matrix tests prove a deterministic closure and the Rust replacement would not improve ownership or distribution.

## Acceptance criteria

- A clean target machine launches the signed desktop application without Node, Bun, pnpm, npm, Git, or a repository checkout.
- The WebView reaches a dynamically allocated authenticated loopback origin only after the complete Host is ready.
- Shipped Cordis plugins, API calls, SSE, client bundles, profile patch reload, Bash, approval, and Harness policy behave as in the Web profile.
- Closing or crashing either process leaves no backend, shell, PTY, agent, or sandbox descendant.
- The Bun backend and Rust IPC protocols have versioned integration tests, including startup failure, malformed records, timeout, cancellation, and forced teardown.
- Each release target is built from a generated closed manifest and passes clean-machine, native-service, signing, update, and non-ASCII-path tests.
- User plugin installation is transactional and policy-controlled and never invokes a system package manager.

## Risks

Bun standalone compilation may not preserve every dynamic module behavior; the generated built-in manifest deliberately trades arbitrary package lookup for a closed shipped graph. User plugins therefore require a separate external loading and installation design.

Moving subprocess, PTY, and sandbox mechanics to Rust introduces an IPC protocol and cross-language lifecycle testing. It buys deterministic native distribution only if the implementation preserves output, cancellation, termination, and policy semantics exactly.

Tauri and the backend create two release artifacts per target. Their protocol and resource-manifest versions must fail loud when mismatched, and the updater must publish them atomically.
