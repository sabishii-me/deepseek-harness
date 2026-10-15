/** Session-owned native presentation. No entry authorizes execution or schedules work. */
export interface JouzuUiState {
  /** Host receipt time; absent for snapshots created before timestamp projection. */
  readonly receivedAt?: number | undefined
  readonly statuses: readonly { readonly key: string; readonly text: string }[]
  readonly widgets: readonly { readonly key: string; readonly lines: readonly string[]; readonly placement: 'aboveEditor' | 'belowEditor' }[]
  readonly notification: { readonly message: string; readonly level: 'info' | 'warning' | 'error' } | null
  readonly flow: string | null
  readonly lifecycle: 'observed' | 'unavailable' | 'closed'
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Ignorable presentation snapshot; never converted to model input or replayed as native commands. */
    'plugin:jouzu-backend/ui': JouzuUiState
  }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { jouzuUi: JouzuUiState | null }
  interface SessionProjectionMap { jouzuUi: JouzuUiState | null }
}

/** Durable observations of native tasks and background executions. */
export interface JouzuActivityView {
  waits: { id: string; reason: string; status: string; handles: string[] }[]
  tasks: { id: string; title: string; status: string; waiting: boolean; paused?: boolean | undefined }[]
  jobs: { execution: string | null; id: string; title: string; status: string; startedAt: number | null; updatedAt: number | null; exitCode: number | null; work: string | null }[]
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    jouzuActivity: JouzuActivityView & { calls: { id: string; name: string; args: string }[] }
  }
  interface SessionProjectionMap { jouzuActivity: JouzuActivityView }
}

/** Observed facts for the most recent foreground dispatch, not inferred model-input inclusion. */
export interface JouzuDeliveryView {
  turn: number
  submitted: boolean
  acknowledged: boolean
  assistantObserved: boolean
  outcome: 'open' | 'completed' | 'aborted' | 'error'
}
declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Transport milestone only; acknowledgement does not certify model receipt. */
    'plugin:jouzu-backend/delivery': { turn: number; phase: 'submitted' | 'acknowledged' }
  }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { jouzuDelivery: JouzuDeliveryView | null }
  interface SessionProjectionMap { jouzuDelivery: JouzuDeliveryView | null }
}
