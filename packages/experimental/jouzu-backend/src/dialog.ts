/** Native extension dialogs use DSH's existing Session-scoped question answerer. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { JouzuRecord } from './types.ts'

/** Ask a native question without converting confirmations into executable tool approvals.
 * @param ctx - driver context, resolving the optional native DSH question service.
 * @param agent - exact registered Session owner.
 * @param record - validated RPC envelope with method-specific untrusted fields.
 * @param signal - owning native-process and turn lifetime.
 * @returns native dialog reply; dismissal/timeout cancels and never approves.
 */
export async function answerJouzuDialog(ctx: Context, agent: Agent, record: JouzuRecord, signal: AbortSignal): Promise<JouzuRecord> {
  if (typeof record.id !== 'string' || typeof record.title !== 'string') throw new Error('Invalid Jouzu dialog identity/title')
  const { id, method } = record
  if (!['select', 'confirm', 'input', 'editor'].includes(String(method))) throw new Error('Unsupported Jouzu dialog method')
  let options: string[] | undefined
  if (method === 'confirm') options = ['Yes', 'No']
  if (method === 'select') {
    if (!Array.isArray(record.options) || record.options.some(value => typeof value !== 'string')) throw new Error('Invalid Jouzu dialog options')
    options = record.options as string[]
  }
  let timeout: AbortSignal | undefined
  if (record.timeout !== undefined) {
    if (typeof record.timeout !== 'number' || !Number.isSafeInteger(record.timeout) || record.timeout < 0 || record.timeout > 2_147_483_647) throw new Error('Invalid Jouzu dialog timeout')
    timeout = AbortSignal.timeout(record.timeout)
  }
  const lifetime = timeout ? AbortSignal.any([signal, timeout]) : signal
  const service = ctx.get('userQuestions')
  if (!service) throw new Error('Jouzu dialog requires the DSH userQuestions service and a connected answerer')
  const cancelled: JouzuRecord = { type: 'extension_ui_response', id, cancelled: true }
  if (lifetime.aborted) return cancelled
  try {
    const result = await service.ask({ agent, signal: lifetime, questions: [{
      id, question: record.title,
      ...(typeof record.message === 'string' ? { detail: record.message } : typeof record.prefill === 'string' ? { detail: record.prefill } : {}),
      ...(options ? { options: options.map(label => ({ label })) } : {}),
    }] })
    if (lifetime.aborted) return cancelled
    const answer = result.answers.find(answer => answer.id === id)
    if (!answer) return cancelled
    if (method === 'confirm') return { type: 'extension_ui_response', id, confirmed: answer.selected.length === 1 && answer.selected[0] === 'Yes' && !answer.custom }
    const value = method === 'select' ? answer.selected.length === 1 ? answer.selected[0] : undefined : answer.custom
    if (value === undefined || (options && !options.includes(value))) return cancelled
    return { type: 'extension_ui_response', id, value }
  } catch (error) {
    if (lifetime.aborted) return cancelled
    throw error
  }
}
