/** Restricted OpenAI request translation for a process-isolated Jouzu model bridge. */
import { z } from 'zod'
import {
  createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage, ToolCallId,
  type GenerateOptions, type LlmCallConfig,
} from '@deepseek-ai/dsh-llm'

/** Text payloads Pi may send: a string, a text-part array, or null for an empty body. */
const textPart = z.object({ type: z.literal('text'), text: z.string() })
const text = z.union([
  z.string(),
  z.array(textPart).transform(parts => parts.map(part => part.text).join('\n')),
  z.null().transform(() => ''),
])
const call = z.object({ id: z.string().min(1), type: z.literal('function'), function: z.object({ name: z.string().min(1), arguments: z.string() }) })
/**
 * The OpenAI-compatible subset Pi actually sends.
 *
 * Unknown *envelope* keys are tolerated: Pi and its extensions add transport
 * metadata over time (`metadata`, `user`, `service_tier`, provider-private
 * fields), and rejecting the whole turn because of one unrecognized key made
 * every Jouzu turn fail with an opaque 502 before any tool could run. The
 * fields this bridge understands are still read and validated; the rest are
 * ignored rather than promoted into model input.
 */
const message = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content: text }),
  z.object({ role: z.literal('developer'), content: text }),
  z.object({ role: z.literal('user'), content: text }),
  z.object({ role: z.literal('assistant'), content: text.nullable().optional(), reasoning_content: z.string().optional(), reasoning: z.string().optional(), reasoning_text: z.string().optional(), tool_calls: z.array(call).optional() }),
  z.object({ role: z.literal('tool'), tool_call_id: z.string().min(1), content: text }),
])
const request = z.object({
  model: z.literal('selected'), stream: z.literal(true), messages: z.array(message),
  tools: z.array(z.object({ type: z.literal('function'), function: z.object({ name: z.string().min(1), description: z.string().optional(), parameters: z.record(z.string(), z.unknown()), strict: z.boolean().optional() }) })).optional(),
  store: z.literal(false).optional(),
  tool_choice: z.literal('auto').optional(), parallel_tool_calls: z.boolean().optional(),
  stream_options: z.object({ include_usage: z.boolean() }).loose().optional(),
  temperature: z.number().optional(), max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
})

/** Validate the supported wire subset and construct a provider-neutral DSH request.
 * @param body - untrusted Jouzu HTTP body.
 * @param selected - authoritative DSH selection captured by the request owner.
 * @param signal - request/turn cancellation.
 * @returns model input; unsupported modalities/fields fail rather than disappear.
 */
export function translateModelRequest(body: unknown, selected: LlmCallConfig, signal: AbortSignal): GenerateOptions {
  const parsed = request.parse(body)
  if (parsed.max_tokens !== undefined && parsed.max_completion_tokens !== undefined) throw new Error('Ambiguous output token limits')
  return {
    ...selected, signal,
    messages: parsed.messages.map((item) => {
      switch (item.role) {
        case 'system': case 'developer': return createSystemMessage(item.content)
        case 'user': return createUserMessage({ content: [{ type: 'text', text: item.content }], source: { kind: 'user' } })
        case 'tool': return createToolResultMessage({ callId: ToolCallId(item.tool_call_id), content: [{ type: 'text', text: item.content }], isError: false })
        case 'assistant': return createAssistantMessage({ source: { provider: selected.provider, model: selected.model }, content: [
          ...(['reasoning_content', 'reasoning', 'reasoning_text'] as const).flatMap(key => item[key] ? [{ type: 'reasoning' as const, text: item[key] }] : []),
          ...(item.content ? [{ type: 'text' as const, text: item.content }] : []),
          ...(item.tool_calls ?? []).map(tool => ({ type: 'tool-call' as const, id: ToolCallId(tool.id), name: tool.function.name, arguments: tool.function.arguments })),
        ] })
      }
    }),
    ...(parsed.tools === undefined ? {} : { tools: parsed.tools.map(tool => ({ name: tool.function.name, description: tool.function.description ?? '', parameters: tool.function.parameters })) }),
    ...(parsed.temperature === undefined ? {} : { temperature: parsed.temperature }),
    // DSH-selected cap remains authoritative; Pi's bridge-model cap is not a
    // capability claim about the selected provider.
  }
}
