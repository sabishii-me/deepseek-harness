/** Jouzu custom messages are native model-visible user context, not assistant replies. */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Model-visible context injected by a native Jouzu extension; never attributed to the human. */
    'jouzu-extension': { kind: 'jouzu-extension'; customType: string }
  }
}

/** Preserve the exact native context; flow/task-specific display remains a separate consumer.
 * @param message - custom message from the validated RPC envelope.
 * @returns identified DSH user context with explicit native-extension attribution.
 */
export function customUserMessage(message: Record<string, unknown>): UserMessage {
  if (typeof message.customType !== 'string' || !message.customType) throw new Error('Jouzu custom message has no type')
  const raw = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content
  if (!Array.isArray(raw)) throw new Error('Invalid Jouzu custom message content')
  const content: ContentBlock[] = raw.map((value) => {
    if (!value || typeof value !== 'object' || value.type !== 'text' || typeof value.text !== 'string') throw new Error('Unsupported Jouzu custom context block')
    return { type: 'text', text: value.text }
  })
  return createUserMessage({ content, source: { kind: 'jouzu-extension', customType: message.customType } })
}
