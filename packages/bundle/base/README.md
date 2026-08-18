# `@deepseek-ai/dsh-base`

English | [中文](README.zh.md)

The shared dsh core as a profile bundle: [`cordis.patch.yml`](cordis.patch.yml) inserts every base plugin row — model adapters, the shared [`agent-default-model`](../../core/agent-default-model/README.md) selection, tools, persistence, policy, settings/credentials, telemetry, and host-level subagent providers — over the empty profile root, as the first layer of every profile's `dsh.profile.bundles` list. This bundle neither depends on nor mounts the optional Codex and Claude Code providers; an opting-in Profile installs and mounts the selected provider once on the host plane, while Agent Presets decide whether their agents receive the corresponding model-facing delegation tools. Later bundle layers (e.g. [`dsh-web-app`](../web-app/README.md)) and the user's profile `cordis.patch.yml` override these rows by id; a patch replaces a row's whole `config`, so mode-specific values live in mode bundles, not here. The package has no runtime API; the profile composer resolves the patch through the `dsh.bundle.patch` manifest field, never through code.

The patch ships the Bash stack on every platform: `bash-sandbox`/`tool-bash` are active, while their `pwsh-sandbox`/`tool-pwsh` twins remain available but disabled for deployments that select PowerShell through a later patch. On Windows, `dsh-bash-local` resolves Git for Windows or an explicitly configured Bash executable, and the sandbox provider confines it through the Windows ACL restricted-token runner (`dsh-sandbox-local`'s win32 chain → `@deepseek-ai/dsh-sandbox-windows-acl`). The permission surface stays aligned across platforms: `sandbox`/`sandbox-policy`, permission switching, approval, and `fs-sandbox` remain active.

The row set and its rationale are documented inline in the patch file; the [generated composition graph](../../../apps/cli/composition.md) renders it.

## Model Experience

Indirectly, through the inserted rows: this bundle selects the shipped persona-less prompt base, tool set, and DeepSeek adapter that mode bundles specialize, and contributes no model-visible text of its own.

#### KV Cache effect

None directly; each inserted row's package owns its effect.

## Known Limitations and Deferred Work

- **A patch replaces whole row configs** — profile overrides must restate every field a row keeps; there is no deep-merge layer.
- **The Windows temp grant is a private per-session subdirectory** — `workspace-write` confines writes to the workspace plus the session's own temp subdirectory (`<temp>\dsh-<hash>`, TMP/TEMP rewritten for confined children); `read-only` grants nothing. See `@deepseek-ai/dsh-sandbox-windows-acl`.
