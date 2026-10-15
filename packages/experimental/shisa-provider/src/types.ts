/** Secret-free account state sent to the initiating UI. */
export interface ShisaStatus {
  phase: 'signed-out' | 'waiting' | 'ready' | 'error'
  url?: string
  code?: string
  message?: string
  organization?: string
  catalogPhase?: 'idle' | 'loading' | 'ready' | 'error'
  catalogError?: string
  baseURL?: string
  catalogURL?: string
  catalogUpdatedAt?: number
  models?: { id: string; name: string; contextWindow?: number; maxTokens?: number }[]
  modelCount: number
}
