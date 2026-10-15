/** Distinct transport and assistant observations; RPC acknowledgement is not model delivery. */
import { z } from 'zod'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { JouzuDeliveryView } from './ui-types.ts'
const receipt = z.object({ turn: z.number().int().positive(), phase: z.enum(['submitted', 'acknowledged']) })
const schema: z.ZodType<JouzuDeliveryView> = z.object({
  turn: z.number(), submitted: z.boolean(), acknowledged: z.boolean(),
  assistantObserved: z.boolean(), outcome: z.enum(['open', 'completed', 'aborted', 'error']),
})
/** Latest foreground turn observations, replayed independently of native Flow diagnostics. */
export const deliveryProjection = {
  key: 'jouzuDelivery', stateVersion: 1, stateSchema: schema.nullable(),
  init: (): JouzuDeliveryView | null => null,
  apply(state, event) {
    const record = pluginRecordOf(event)
    if (record?.type === 'plugin:jouzu-backend/delivery') {
      const value = receipt.parse(record.data)
      const current = state?.turn === value.turn ? state : {
        turn: value.turn, submitted: false, acknowledged: false, assistantObserved: false, outcome: 'open' as const,
      }
      return { ...current, submitted: true, acknowledged: current.acknowledged || value.phase === 'acknowledged' }
    }
    if (!state) return state
    if (event.type === 'assistant/message' && event.data.turn === state.turn) return { ...state, assistantObserved: true }
    if (event.type === 'turn/end' && event.data.turn === state.turn) {
      const kind = event.data.reason.kind
      return { ...state, outcome: kind === 'aborted' ? 'aborted' as const : kind === 'error' ? 'error' as const : 'completed' as const }
    }
    return state
  },
  wire: { viewSchema: schema.nullable(), view: (state: JouzuDeliveryView | null) => state },
} satisfies ProjectionDefinition<'jouzuDelivery', JouzuDeliveryView | null>
