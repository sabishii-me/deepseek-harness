/** Jouzu RPC records preserved for backend and UI consumers. */
import type { Session } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** JSON object received from Jouzu; product payloads are not rewritten as DSH jobs. */
export interface JouzuRecord { [key: string]: JsonValue }

/** Explicit deployment bounds and executable selection. */
export interface Config {
  /** Enable the explicit PowerShell/write-only restricted test mode. */
  restrictedToolTest?: boolean

  /** Credential reference names resolved only for the owning subprocess. */
  credentialEnv?: Record<string, string>
  /** Maximum retained native status/widget keys. */
  uiEntryLimit?: number
  /** Maximum JSON characters in a retained UI snapshot. */
  uiTextLimit?: number
  /** Executable argv prefix, for example node followed by Jouzu's cli.js. No shell expansion. */
  argv: string[]
  /** Explicit additions to the subprocess provider's scrubbed environment. */
  env: Record<string, string>
  /** Maximum encoded bytes in either one incoming or outgoing JSON record. */
  maxRecordBytes: number
  /** Maximum simultaneously outstanding command responses. */
  maxPendingRequests: number
  /** Model bridge request deadline. */
  modelTimeoutMs?: number
  /** Command acknowledgement deadline, not a model-turn deadline. */
  requestTimeoutMs: number
  /** EOF grace before terminating the managed process range. */
  eofGraceMs: number
  /** Subprocess provider termination grace. */
  terminateGraceMs: number
}

/** Input to a caller-owned native conversation. */
export interface OpenOptions {
  /** Open the owning Agent's public DSH tool capability after startup admission. */
  toolBridge?: (restricted?: boolean) => Promise<{ url: string; token: string; dispose(): Promise<void> }>

  /** Cancels unpublished startup; returned conversation owns its subsequent lifetime. */
  signal?: AbortSignal
  /** Session supplying execution authority; required even for direct service consumers. */
  session: Session
  /** Capture the owning DSH Session model at each provider request. */
  modelSelection?: () => import('@deepseek-ai/dsh-llm').LlmCallConfig
  /** Absolute workspace path in the subprocess execution world. */
  cwd: string
  /** Explicit native session file to reopen; omitted creates a fresh session. */
  sessionFile?: string
}

/** Sink installed before startup so extension UI records cannot be lost. */
export interface JouzuSink {
  /** Receives non-response records, including custom messages and extension UI requests. */
  event(record: JouzuRecord): void
  /** Reports terminal transport failure; acceptance of outstanding commands may be unknown. */
  failure(error: Error): void
}
