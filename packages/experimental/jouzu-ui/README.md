# Experimental Jouzu Session UI

English | [中文](README.zh.md)

## Usage

Opt in alongside jouzu-backend in a web profile overlay. The plugin uses the existing conversation input dock and keyed tool-call slots. Native DSH Sessions render no Jouzu work panel. There are no mock switches, fixture scenarios or alternate chat panels.

## Work presentation

The work dock uses the same TaskList primitive as native DSH Todo. It reads jouzuActivity and displays recorded unfinished tasks, background executions and dependencies. Empty and terminal-only observations render nothing. Terminal results remain in the ordinary tool transcript. Historical running receipts are labeled as last observed running, not animated as confirmed live execution. No task total or completion ratio is inferred from incomplete observations.

TaskCreateMany, TaskCreate, TaskUpdate, TaskList, bg_task and agent_wait use keyed tool views in the existing conversation. Native questions continue through the standard DSH question composer. Native diagnostics and transport milestones are not shown in the work dock. The Session inspection API remains available for explicit diagnostic consumers; rendering this plugin never invokes it.

## Model Experience

The UI adds no model input, tools, scheduler or cancellation operations. It does not change token accounting or KV-cache policy. Task ownership stays with Jouzu; shared Todo presentation does not convert native work into DSH tasks.

## Known Limitations and Deferred Work

Observations are receipt-based, not an authoritative native task inventory. Older text-only tool results lack background metadata and cannot be reconstructed automatically. Background completion notifications update known executions only by matching their exact native execution identity. Terminal component widget factories are not exposed by Pi RPC. Job cancellation and Flow mutation controls are not supplied. Native DSH foreground Stop does not claim to cancel background jobs. Exact-match recovery restrictions and supported input types remain owned by jouzu-backend. Full real-work and platform qualification remains pending.

Completed background work is retained in a separate results disclosure using native completion receipts; it is not inferred from foreground settlement. Native receipt titles remain visible, including an exit status when supplied. Foreground Stop and background task stop remain distinct operations.

## Live progress

Jouzu Sessions show a running indicator above the composer as soon as DSH reports running. During an active assistant response, the same area displays reasoning from the official Chat snapshot as chunks arrive, independently of transcript folding. It clears at settlement and never reuses reasoning from completed assistants. Native transcript/history rendering remains unchanged. This view uses only public Session and Conversation hooks; it creates no additional transport, stored reasoning copy or Host event.
