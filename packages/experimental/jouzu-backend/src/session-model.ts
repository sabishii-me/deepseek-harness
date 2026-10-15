import type {} from '@deepseek-ai/dsh-api-session-controller/types'
/** Resolve the same durable selection written by official DSH's model picker. */
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'

/** Capture the current model without reading an API controller's private cache.
 * @param session - owning Session containing official model-selection events.
 * @param fallback - initial resolved Agent model options.
 * @returns immutable-by-copy configuration for the next model request.
 */
export function selectedSessionModel(session: Session, fallback: AgentOptions): LlmCallConfig {
  // This preview uses the public snapshot reader; a plugin-owned projection
  // can replace the scan without adding a Host event or API.
  const events = session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    if (event.type === 'model/selection') {
      const { provider, model, reasoningEffort } = event.data
      return { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) }) }
    }
    if (event.type === 'request/header') {
      const { provider, model, reasoningEffort, maxTokens } = event.data.header.config
      return { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }), ...(maxTokens === undefined ? {} : { maxTokens }) }
    }
  }
  if (!fallback.provider || !fallback.model) throw new Error('Select a DSH model before starting Jouzu')
  return { provider: fallback.provider, model: fallback.model,
    ...(fallback.reasoningEffort === undefined ? {} : { reasoningEffort: fallback.reasoningEffort }),
    ...(fallback.maxTokens === undefined ? {} : { maxTokens: fallback.maxTokens }),
  }
}
