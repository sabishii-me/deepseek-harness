/** Validated, bounded native presentation projected through the ordinary Session stream. */
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { JouzuRecord } from './types.ts'
import type { JouzuUiState } from './ui-types.ts'

const schema: z.ZodType<JouzuUiState> = z.object({
  receivedAt: z.number().optional(),
  statuses: z.array(z.object({ key: z.string(), text: z.string() })),
  widgets: z.array(z.object({ key: z.string(), lines: z.array(z.string()), placement: z.enum(['aboveEditor', 'belowEditor']) })),
  notification: z.object({ message: z.string(), level: z.enum(['info', 'warning', 'error']) }).nullable(),
  flow: z.string().nullable(),
  lifecycle: z.enum(['observed', 'unavailable', 'closed']),
})

/** Replayable UI-only snapshot, independent of native process availability. */
export const jouzuUiProjection = {
  key: 'jouzuUi', stateVersion: 2, stateSchema: schema.nullable(),
  init: (): JouzuUiState | null => null,
  apply: (state, event) => {
    const record = pluginRecordOf(event)
    return record?.type === 'plugin:jouzu-backend/ui' ? { ...schema.parse(record.data), receivedAt: event.time } : state
  },
  wire: { viewSchema: schema.nullable(), view: (state: JouzuUiState | null) => state },
} satisfies ProjectionDefinition<'jouzuUi', JouzuUiState | null>

/** Empty presentation at native process startup.
 * @returns no inherited live status or widget from a previous process.
 */
export function emptyJouzuUi(): JouzuUiState {
  return { statuses: [], widgets: [], notification: null, flow: null, lifecycle: 'observed' }
}

/** Fold supported RPC presentation without executing HTML, terminal commands or native tasks.
 * @param state - current process presentation.
 * @param record - native RPC event.
 * @param limits - configured aggregate entry and text retention bounds.
 * @returns updated snapshot, or undefined for records owned by other consumers.
 */
export function receiveJouzuUi(state: JouzuUiState, record: JouzuRecord, limits: { entries: number; text: number }): JouzuUiState | undefined {
  const text = (value: unknown): string => {
    if (typeof value !== 'string') throw new Error('Invalid Jouzu UI text')
    // C0 controls and ANSI escapes have no browser presentation semantics.
    return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
  }
  const key = (value: unknown): string => {
    const result = text(value)
    if (!result) throw new Error('Invalid Jouzu UI key')
    return result
  }
  let next: JouzuUiState
  if (record.type === 'extension_ui_request' && record.method === 'notify') {
    const level = record.notifyType === undefined ? 'info' : record.notifyType
    if (level !== 'info' && level !== 'warning' && level !== 'error') throw new Error('Invalid Jouzu notification level')
    next = { ...state, notification: { message: text(record.message), level } }
  } else if (record.type === 'extension_ui_request' && record.method === 'setStatus') {
    const id = key(record.statusKey)
    const statuses = state.statuses.filter(item => item.key !== id)
    if (record.statusText !== undefined) statuses.push({ key: id, text: text(record.statusText) })
    next = { ...state, statuses }
  } else if (record.type === 'extension_ui_request' && record.method === 'setWidget') {
    const id = key(record.widgetKey)
    const widgets = state.widgets.filter(item => item.key !== id)
    if (record.widgetLines !== undefined) {
      if (!Array.isArray(record.widgetLines)) throw new Error('Invalid Jouzu text widget')
      const placement = record.widgetPlacement === undefined ? 'aboveEditor' : record.widgetPlacement
      if (placement !== 'aboveEditor' && placement !== 'belowEditor') throw new Error('Invalid Jouzu widget placement')
      widgets.push({ key: id, lines: record.widgetLines.map(text), placement })
    }
    next = { ...state, widgets }
  } else if (record.type === 'message_end' && record.message && typeof record.message === 'object' && !Array.isArray(record.message)
    && record.message.role === 'custom' && record.message.customType === 'jouzu-flow') {
    const content = record.message.content
    const flow = typeof content === 'string' ? text(content) : Array.isArray(content) ? content.map((part) => {
      if (!part || typeof part !== 'object' || Array.isArray(part) || part.type !== 'text') throw new Error('Invalid Jouzu flow text')
      return text(part.text)
    }).join('\n') : text(content)
    next = { ...state, flow }
  } else return undefined
  if (next.statuses.length + next.widgets.length > limits.entries || JSON.stringify(next).length > limits.text) {
    throw new Error('Jouzu UI retention limit exceeded')
  }
  return next
}
