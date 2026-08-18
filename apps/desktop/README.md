# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

The Tauri 2 development supervisor for the Bun-hosted DSH Web profile. It starts the checkout backend on an OS-assigned loopback port, waits for the existing `dsh web:` readiness line, and navigates the WebView to the complete Host application rather than loading `apps/web/dist` through `file://`.

## Development checkpoint

Prerequisites are Bun 1.3.14 or newer, Rust, the platform Tauri prerequisites, and the repository dependencies. From the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @deepseek-ai/dsh-desktop run prepare:dev
corepack pnpm --filter @deepseek-ai/dsh-desktop tauri dev
```

After the first build, the final command alone restarts Tauri against the existing artifacts. Run `corepack pnpm run build` after changing Host or Web artifacts; `pnpm run dev:web` may run alongside Tauri for client-plugin bundle HMR.

This checkpoint runs `apps/desktop/backend/dev.ts` with the installed Bun command. It is not the release closure and does not produce a self-contained installer yet. Bun 1.3.14 cannot load the optional pi-ai adapter, Node's `stripTypeScriptTypes` code-runtime provider, or the Node-internal configuration HMR service, so the desktop development overlay disables those rows and pins the browse directory-picker Host provider. Client-plugin SSE HMR remains mounted. Bun 1.3.14 also crashes in Koffi's Windows finalizer, so this checkout checkpoint selects explicit filesystem fallbacks for the affected durable namespace operations; release builds must move those operations behind Rust without weakening their durability contract.

Persistent Bash on Windows does not use `node-pty` in the desktop deployment. The Tauri process starts an authenticated per-launch loopback terminal service, owns ConPTY and Git Bash, and provides terminal input, output, resize, Ctrl-C, termination, and exit facts through the existing `ctx.subprocess.spawnTerminal()` seam. Harness policy, approval, sandbox resolution, terminal readiness, and the model-visible Bash contract remain in Cordis.

## Model Experience

The desktop supervisor contributes no model-visible text or tools. Sessions use the Web profile's existing prompt, Cordis plugin graph, Bash tool, approval, and Harness policy.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

The checkpoint still parses a human-readable backend readiness line, has no authenticated WebView HTTP session, and force-cleans the backend process tree on exit instead of first using a private shutdown protocol. The Rust terminal channel is authenticated, but its protocol is not yet versioned and its Windows implementation still needs Job Object ownership, complete descendant accounting, strict signal semantics, backpressure, and disconnect teardown coverage. Navigation and external-link restrictions, structured control records, the remaining Rust process services, deterministic deployment manifest, and signed installers belong to the proposed [desktop runtime architecture](../../.agents/notes/proposed/architecture/2026-08-18-tauri-bun-desktop-runtime.md).
