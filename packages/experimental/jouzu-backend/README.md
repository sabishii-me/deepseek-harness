# Experimental Jouzu backend

English | [中文](README.zh.md)

## Status

Work in progress: this package supplies the optional `ctx.jouzuBackend` Cordis service for long-lived native Jouzu RPC conversations. The independent preview UI has been removed. When Agent and projection services are mounted, this plugin registers the `jouzu` Agent driver with the existing lifecycle factory. The existing preset menu can create a Jouzu-backed Session; native DSH stays the default. DSH defaults are unchanged. Target: official Jouzu 0.1.18 / bundled Pi 0.87.1.

## Configuration and consumption

Mount the service alongside a subprocess provider. `argv` is a required executable prefix, for example `["node", "/absolute/path/to/jouzu/dist/cli.js"]`; the service appends `pi --mode rpc` and an optional `--session` file. A direct npm `.cmd` launcher on Windows is not supported by this package; select Node and the CLI entry explicitly. Native Jouzu settings, extensions, authentication and permissions remain authoritative; DSH permissions do not govern Jouzu's tools. Explicit `env` entries extend the subprocess service's scrubbed environment.

Limits default to 8 MiB per JSON record, 32 pending command acknowledgements, a 30-second acknowledgement deadline, 6 seconds of EOF grace and 3 seconds of subprocess termination grace. All are plugin configuration fields. The acknowledgement deadline is not a turn timeout: expiry terminates the conversation because command acceptance may be unknown, and never retries a prompt.

A host consumer calls `open({ cwd, sessionFile? }, sink)` with absolute paths and synchronous `event` / `failure` callbacks. The sink is installed before startup. The returned conversation exposes the initial successful `get_state` response, `request(command, fields?)`, `respond(extensionResponse)`, and idempotent async `dispose()`. Command success means acknowledgement only. A remote rejection leaves transport usable; malformed output, missing response, stream failure, or a throwing event consumer stops it. Disposal closes admission, requests EOF, then escalates and joins the subprocess range. Plugin unload disposes owned conversations.

## Jouzu feature presentation

Native notifications, keyed status entries, text widgets and latest Flow context feed a bounded Session projection consumed by the optional jouzu-ui dock. Presentation snapshots use ignorable plugin:jouzu-backend/ui records and never enter model history. uiEntryLimit defaults to 128 retained status/widget keys; uiTextLimit defaults to 262144 JSON characters per snapshot. Invalid or oversized presentation fails the native event consumer rather than silently discarding state. Terminal component factories remain unsupported by Pi RPC.

inspectFlow reads only an already-running process, verifies the flow extension command, and submits the official no-argument /flow command. It remains available during active native turns, shares concurrent inspection requests, and does not acquire maintenance or write a history checkpoint. It does not send model input, reopen a stored native session, resume automation or cancel jobs. Native select/input/editor/confirm dialogs use the existing DSH question answerer; idle dialogs now follow the process lifetime rather than an already-ended turn. Foreground abort remains distinct from background cancellation.

## Model Experience

The plugin sends only caller-supplied native commands. Jouzu owns prompt construction, model tokens and KV-cache behavior. The transport adds no DSH model tools, prompts or model calls.

## Known Limitations and Deferred Work

- The existing DSH transcript and optional Session dock are reused; no separate preview panel is shipped.
- Native dialogs and text presentation are integrated; background task-specific controls and component widgets remain unavailable.
- The caller must interpret native command results and preserve native session identity. A file argument alone does not prove successful resume of the intended session.
- Schema validation currently covers the RPC envelope, not every native event or command payload. Do not expose arbitrary commands as an unauthenticated browser endpoint.
- Package unit tests cover framing and lifecycle with mock peers; real Loader/profile composition and recorded frontend snapshots remain required before shipping.
- The separate official-release smoke verified keyless startup/get_state/EOF, not this plugin against a real model or background task.

## Native Agent integration in progress

The `jouzu` driver consumes the shared durable inbox and emits standard user, assistant, tool, turn and step Session events plus the existing live assistant stream. It does not create a separate chat controller. The factory retains Session publication and persistence ownership. `agent/backend` records immutable execution ownership; `jouzu/binding` records the native id and file before prompt dispatch. Reattachment checks the native identity returned by Jouzu and refuses a mismatch. A durable binding is not a reconciliation protocol: missed native output after a host crash remains an unresolved recovery limitation.

The driver currently accepts text-only ordinary queued messages. Steering and injected DSH context reject explicitly. Native dialogs and autonomous turns now use the standard question and turn lifecycles described below. These restrictions make the plugin incomplete for ordinary Jouzu use; do not expose it as a production-ready selectable backend. Tool and message conversion still needs exhaustive native schema/usage/error coverage, recorded frontend snapshots, and real-process resume/cancellation tests.

## Browser-verified development path

The local overlay `.artifacts/jouzu/native.patch.yml` mounts the backend and an empty-tool Jouzu preset with `backend: jouzu`. It is machine-local and uses the official 0.1.18 installation tested here. Launch with `pnpm dsh --profile web --patch .artifacts/jouzu/native.patch.yml --port 3000`, then select Jouzu from the normal new-session preset menu. The existing composer, Chat, Trajectory, Session list and Stop control are reused; no preview panel or extra chat API is mounted.

A real Edge browser run completed two actual model replies, reloaded their history, submitted a subsequent native Bash request, displayed a running Bash tool in the normal tool area, and stopped it using Stop generating. The model control now uses backend-owned catalog and selection operations; the native DSH permission selector remains hidden for external-backend Sessions. These observations do not cover host-crash reconciliation, full native task panels, all tool renderers, or every unsupported control. Native slash commands currently reject before admission; dialog requests and autonomous turns fail explicitly rather than silently completing. The backend is experimental, not full Jouzu feature parity.

## Session model controls

The standard Session model UI reads Jouzu's native catalog through Agent-owned model controls. Explicit catalog loading may start the native process without submitting a prompt; reconnect does not automatically request an external catalog. Native provider IDs are preserved. An absent native model remains unselected, never replaced by the DSH global default. The driver excludes concurrent turns/control operations, verifies set_model and get_state responses, exposes get_available_thinking_levels for the current model, and records model/selection plus a native checkpoint before acknowledging mutation. DSH default settings are not written. A failed multi-command mutation stops native admission because an earlier command may already have committed. Recovery still uses exact-match checkpoints. Browser acceptance and full mutation/recovery race coverage remain pending.

## Native token accounting

Completed assistant messages carry Jouzu usage into both the standard usage stream chunk and durable assistant event. Native input, output, cache-read and cache-write counters retain their units; the total is their safe-integer sum. Native `reasoning` becomes `reasoningTokens`, a subset of output, only when reported as a valid count no greater than output. Missing reasoning is unknown, not zero or a text-length estimate. Invalid aggregate accounting is omitted. Previously saved messages without usage are not backfilled.

## Continuations, dialogs and terminal failures

Native custom messages are retained verbatim as standard user-context messages with `jouzu-extension` attribution, matching Pi's conversion to model-visible user context. They are not human prompts, assistant answers, or instructions executed again by DSH. Autonomous native runs acquire standard DSH turn/status ownership; human follow-ups remain in the existing inbox until native settlement. Dedicated flow/job/task projections remain deferred; preserving context alone does not implement job cancellation or progress controls.

Extension select/input/editor/confirm requests use the existing `userQuestions.ask()` answerer and composer. Replies preserve native request ids; timeout, turn cancellation and plugin disposal never approve. Confirmation here is an extension question, not a claim that DSH authorized Jouzu's execution permissions. Full dialog browser and restart verification remains pending.

A terminal native failure retains the original cause, emits `agent/error`, cancels queued input rather than replaying it, and rejects subsequent submission as `AgentBackendUnavailableError`. The Session API reports `session/backend-unavailable`, not temporary busy. A late idle failure appends an error turn so the last visible result does not stay successful. Explicit factory disposal still owns process/scope/session release. Recovery must inspect native history; this change does not automatically restart or reconcile a failed native process.

## Execution policy admission

Startup requires the exact owning Session and DSH sandboxPolicy. The resolved DSH mode is authoritative: danger-full-access uses the original argv with reported unconfined execution; read-only and workspace-write require sandbox.confine over the complete argv. The provider's full/partial classification is preserved, not upgraded or rejected by an additional Jouzu policy. A missing provider or failed runner under a restricted mode never retries unconfined. Partial and unconfined execution are reported through the host logger.

Commands, dialog replies and events recheck the pinned policy. Session sandbox/mode changes revoke the native process even when stdout is silent. Startup cancellation joins unpublished children; policy observation ends on disposal. This follows DSH's file-effect vocabulary, not a new promise of read, credential or network isolation. Windows ACL remains partial with its documented limits; full-access is an existing DSH grant, not a new Jouzu bypass switch. Real restricted-runner qualification remains pending.

## Exact-match native recovery

After an observed settled turn, the driver records a canonical SHA-256 digest of get_entries history, entry count and active leaf id as jouzu/checkpoint, then flushes the Session. A reopened native binding must report no active/queued work and the exact checkpoint before a new prompt is sent. Unknown checkpoints, changed content or moved branches refuse submission; no prompt is automatically replayed. This does not import missing native history or recover old sessions without checkpoints. Native events racing checkpoint acquisition prevent that observation from being certified; later recovery fails closed instead of guessing. Full real-process recovery qualification remains pending.

Native tool result details are preserved in the existing tool/result meta field. jouzuActivity incrementally pairs tool receipts with calls to project successful task creation/update and background execution observations. It reads the exact native task ids from creation receipts and never creates task identities, writes task files or schedules work.

Foreground dispatch now records separate ignorable transport milestones. jouzuDelivery projects command acknowledgement and same-turn durable assistant output independently; neither fact proves exact model-input inclusion. An error or interruption preserves earlier observations. Native Flow diagnostics do not overwrite these facts. Third-party installations are not modified by this integration.

Before closing a native step, the bridge uses DSH ToolCallRecovery to record conservative error results for assistant tool requests without results. Calls without a recorded dispatch are not-started; dispatched calls without receipts remain outcome-unknown. No native operation is retried. This prevents new unbalanced steps; already persisted closed-step corruption requires a separately reviewed recovery and is not silently rewritten.

Activity projection accepts the official single-task creation receipt and TaskList inventory, including an empty inventory; successful list reads replace earlier task observations. Task creation reads wait-for-user from metadata.flowControl. Background completion records match the native execution id.

## Official model bridge qualification

The plugin-owned `session-model` reader consumes official `model/selection` events and captures the selected route for each model request. `model-request` validates the text/tool OpenAI request subset before conversion to DSH messages; images and unsupported request fields are rejected rather than dropped. This path has been exercised with an independent unmodified Jouzu process against official DSH packages, including two selected routes and a real Jouzu echo tool round trip. It is not yet connected to the browser's Jouzu factory. The existing backend entry still depends on development Host driver APIs and must not be installed as an official-compatible backend preview.

The replacement factory implementation is plugin-owned (`external-factory.ts`): it acquires official Session persistence write handles, composes an unpublished external Agent, commits setup, then enters and announces the global registries. Failure unwinds the scope, persistence handle and registry entries; owner/factory unload cancels and drains live drivers. `factory-router.ts` selects the external factory from the existing ordinary preset identity, leaving model selection independent. These modules are not yet wired into the package's legacy entry point.

The model request translator preserves plain reasoning text replayed by Pi in `reasoning_content`, `reasoning`, or `reasoning_text` as DSH reasoning blocks. Structured provider-private reasoning signatures remain outside this validated subset. A native history/checkpoint mismatch refuses new submissions rather than replaying a previous prompt or rewriting its checkpoint.

A received `agent_settled` can close either a successful or failed model run. Both record an observed stable native checkpoint before reporting their outcome, allowing later explicit input after restart. A transport failure or changing history does not certify a checkpoint. Existing mismatches are never rewritten or automatically replayed by this behavior.

## Portable preview composition

The packed `config/jouzu.patch.yml` uses package names, not developer source paths. Set `DSH_JOUZU_CLI` to the independently installed Jouzu `cli.js` and `DSH_JOUZU_HOME` to an explicitly chosen dedicated state directory. The directory must be writable under the DSH permission mode the user selects; the overlay does not change that mode. Load Shisa separately if desired. The preview replaces the standard preset UI with an explicit new-session execution selector, so full preset settings/header parity is not yet provided. Existing drafts stay in their original sessions. Missing environment settings fail instead of selecting a local fallback. The supplied CLI path is not a bundled or modified Pi runtime.

The model bridge streams text, reasoning and tool argument deltas as received, waits for response backpressure, and cancels upstream on connection closure. It no longer waits for the entire model response before returning the first text. Midstream failures terminate the transport without emitting a successful completion marker.

## Tool argument stream settlement

The model bridge accepts a final tool block whose complete JSON value equals the arguments already streamed, even when the provider adapter canonicalizes whitespace or object key ordering. It sends no duplicate argument bytes. Changed tool identities, names or JSON values still fail the request. Encoder regressions and an HTTP regression through the official LlmRuntime cover canonicalized arguments, terminal tool completion and usage delivery.

## DSH tool bridge implementation

`tool-bridge.ts` exposes an authenticated loopback catalog and executor bound to one DSH Agent. An explicit admission list and the current Agent-scoped registry view constrain discovery and execution. Calls run through the public DSH tools pipeline with initiating Agent attribution; HTTP disconnection cancels execution, and disposal drains admitted work. Repeated call ids are refused rather than replayed. The bridge itself emits no duplicate Session tool receipts: native Jouzu execution events remain the transcript source.

`tool-extension.ts` is an independently loaded public Pi extension. JouzuAgent startup now opens its scoped tool bridge, and backend startup loads this extension alongside the model bridge. Admission snapshots the currently visible DSH names; execution rechecks visibility. The extension registers admitted tools under `dsh_` aliases, leaving existing Pi tools untouched, forwards cancellation, and preserves error flags and presentation metadata. It maps concluding tool results to Pi termination. Deferred text context is appended to the native tool result, not submitted as a separate asynchronous turn; this changes its role from separate context to tool content while preserving it in native history and the next model request. Native tool events remain the sole source of transcript tool receipts. Catalog refresh and image/file content conversion are subsequent integration work.

An isolated process check uses unmodified Jouzu 0.2.0 and installed official DSH packages with a deterministic model driver: Jouzu calls the registered DSH tool, the official tool pipeline executes once, and Jouzu receives the result and completes the next model step. This check is separate from the user-facing installation and does not install its model driver there.

Background observations accept both bg_task and bg_status receipts. Complete list arrays replace the inventory (including empty lists); bounded manifests do not. Successful clear removes observed terminal jobs. Execution identity, start time and update time prevent stale receipts from reverting terminal state or overwriting a reused handle. Activity projection version 4 rebuilds these observations from existing Session events, including status reads that suppressed completion wakes.

## Workspace Write interactive test mode

Set `restrictedToolTest: true` on the backend to opt into the explicitly limited test mode. A Session started under Workspace Write or Read Only loads only `powershell` and `write` through Pi's public tool allowlist and our public extension. Both route to the owning DSH Agent's `pwsh`/`write` tools; those tools must be composed in the Jouzu preset. The HTTP executor rejects background and escalation arguments. Native bash, background tools and subagents are unavailable in this mode; slash command submission is already refused. The trusted harness process stays outside the OS sandbox, like DSH's Host; model-controlled shell execution is confined by DSH. This is not isolation of arbitrary installed extension code. Restricted state is stored under the selected workspace's `.jouzu-dsh-restricted` directory. A running restricted process refuses policy changes; use a fresh Session for a different mode.

Full-access Sessions retain the normal native tool set and existing execution path. This switch does not alter the global permission defaults or rewrite existing Session histories. A Windows directory must still support the official ACL sandbox initialization for PowerShell commands.
