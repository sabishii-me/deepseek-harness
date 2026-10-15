/** Preserve native Pi usage units; cache and reasoning counters are not extra output. */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Translate optional Jouzu 0.1.18 usage without inventing a missing reasoning breakdown.
 * @param value - native assistant message usage from RPC.
 * @returns validated DSH usage; absent or invalid accounting is omitted.
 */
export function jouzuUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const usage = value as Record<string, unknown>
  if (!count(usage.input) || !count(usage.output) || !count(usage.cacheRead) || !count(usage.cacheWrite)) return undefined
  const total = usage.input + usage.output + usage.cacheRead + usage.cacheWrite
  if (!count(total)) return undefined
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    totalTokens: total,
    ...(count(usage.reasoning) && usage.reasoning <= usage.output ? { reasoningTokens: usage.reasoning } : {}),
  }
}
