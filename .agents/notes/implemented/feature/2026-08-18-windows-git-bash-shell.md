# Agent Note: Windows Git Bash shell stack

Status: implemented

English | [中文](2026-08-18-windows-git-bash-shell.zh.md)

## Problem

The shipped profile disabled `tool-bash` on Windows and exposed a separate PowerShell dialect instead. Coding prompts and existing automation commonly emit Bash syntax, so otherwise portable commands such as Git pipelines could not use the same tool contract on Windows even when Git for Windows already supplied a compatible Bash executable. `dsh-bash-local` also hardcoded the bare `bash` command and never resolved the Git for Windows installation.

## Decision

The shipped base and agent presets expose the Bash executor and `bash` tool on every platform. The PowerShell executor and tool remain available packages but are disabled in the shipped composition; a deployment may select them through its patch layer.

`dsh-bash-local` owns Bash executable resolution. On Windows it resolves an explicit `bashPath` first, then Git for Windows under `ProgramFiles` and `ProgramFiles(x86)`, then `bash.exe` in PATH entries. Absence fails at executor activation instead of at the first model tool call. Other platforms retain the bare `bash` executable. The sandboxing executor now confines the exact argv selected by the local executor rather than reconstructing `['bash', '-c', command]`, so Windows Git Bash and unconfined execution use one executable fact.

This does not claim that Git Bash has POSIX process-group semantics. Ordinary subprocess process-tree termination remains owned by `dsh-subprocess-local`, which uses Windows `taskkill /T /F`; Bash supplies command parsing and Unix command-line utilities, while paths visible inside Bash follow its MSYS conventions.

The minimal preset uses a persistent Bash terminal rather than the ordinary one-shot executor. In the Tauri desktop deployment, `ctx.subprocess.spawnTerminal()` selects a private Rust terminal transport instead of loading `node-pty`: the Tauri process creates ConPTY, starts Git Bash, transports terminal bytes over an authenticated per-launch loopback channel, handles resize and Ctrl-C, and reports exit. Cordis still owns terminal readiness, sandbox policy, approval, and the model-facing tool contract. Non-desktop deployments retain their existing subprocess provider path.

## Alternatives considered

**Keep PowerShell as the Windows default and ask models to translate commands.** Rejected: it preserves two model-visible dialects and leaves Bash-heavy coding workflows platform-dependent.

**Resolve Bash in the bundle patch.** Rejected: executable discovery belongs to the executor that spawns it, must also cover direct consumers, and needs a typed config override.

**Invoke `where bash.exe` and take the first result.** Rejected: Windows app aliases and legacy WSL `bash.exe` may precede Git Bash. Deterministic Git installation roots are preferred before PATH.

## Consequences

Coding-agent prompts and automation use one Bash tool contract across supported hosts, and Windows installations gain a deterministic Git Bash path with an explicit override. Deployments that prefer PowerShell must opt in through composition. Git Bash keeps MSYS path conventions, and Windows process-tree behavior remains different from POSIX process groups.

The desktop persistent-terminal path no longer depends on Bun's compatibility with `node-pty`. Its current Rust implementation is an implemented development checkpoint, not the final process-ownership claim: release closure still requires Windows Job Object ownership, complete descendant accounting, strict signal semantics, protocol backpressure, and disconnect teardown tests.

## Verification

The executor suite covers explicit selection, non-Windows behavior, Git-for-Windows precedence, PATH fallback inputs, and fail-loud absence. Existing real executor and tool integration suites cover command output, Git-compatible process execution, cancellation, background jobs, and sandbox handoff. The base bundle test pins Bash enabled and PowerShell disabled in the shipped composition.

The desktop Rust suite opens a real Windows ConPTY, starts Git for Windows Bash, waits for the transport, writes `printf 'rust-conpty-ok\\n'`, observes the output, and terminates the terminal. Manual acceptance additionally resumed an existing minimal-preset session and successfully ran its persistent Bash command while the Host remained on Bun.
