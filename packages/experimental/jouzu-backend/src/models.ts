/** Native model controls. Provider identifiers belong to Jouzu, not DSH adapters. */
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { JouzuConversation } from './index.ts'
import type { JouzuRecord } from './types.ts'

function object(value: unknown): JouzuRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Jouzu model response')
  return value as JouzuRecord
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid Jouzu model identifier')
  return value
}
function model(value: unknown) {
  const entry = object(value)
  return { provider: text(entry.provider), model: text(entry.id), name: text(entry.name) }
}

/** Read the selected native route without manufacturing an unconfigured model.
 * @param response - acknowledged get_state response.
 * @returns native selection, or null when Jouzu has no model.
 */
export function nativeModelSelection(response: JouzuRecord): ModelSelection | null {
  const state = object(response.data)
  if (state.model === undefined || state.model === null) return null
  const selected = model(state.model)
  return { provider: selected.provider, model: selected.model,
    ...(state.thinkingLevel === undefined ? {} : { reasoningEffort: ReasoningEffortId(text(state.thinkingLevel)) }) }
}

/** Read only models actually advertised by this native process.
 * @param response - acknowledged get_available_models response.
 * @returns provider-grouped native models, with no DSH provider remapping.
 */
export function nativeModelGroups(response: JouzuRecord) {
  const entries = object(response.data).models
  if (!Array.isArray(entries)) throw new Error('Invalid Jouzu model catalog')
  const groups = new Map<string, { id: string; name: string; models: { id: string; name: string }[] }>()
  for (const value of entries) {
    const entry = model(value)
    let group = groups.get(entry.provider)
    if (!group) { group = { id: entry.provider, name: entry.provider, models: [] }; groups.set(entry.provider, group) }
    if (group.models.some(item => item.id === entry.model)) throw new Error('Duplicate Jouzu model route')
    group.models.push({ id: entry.model, name: entry.name })
  }
  return [...groups.values()]
}

/** Mutate a route and verify native readback; callers own exclusion and persistence.
 * @param native - owning native process.
 * @param selection - exact native provider/model and optional thinking level.
 * @returns verified native selection, including the actual thinking level.
 */
export async function selectNativeModel(native: Pick<JouzuConversation, 'request'>, selection: ModelSelection): Promise<ModelSelection> {
  const groups = nativeModelGroups(await native.request('get_available_models'))
  if (!groups.some(group => group.id === selection.provider && group.models.some(item => item.id === selection.model))) {
    throw new Error('Requested model is absent from the Jouzu catalog')
  }
  const acknowledged = model((await native.request('set_model', { provider: selection.provider, modelId: selection.model })).data)
  if (acknowledged.provider !== selection.provider || acknowledged.model !== selection.model) throw new Error('Jouzu acknowledged a different model')
  if (selection.reasoningEffort !== undefined) {
    const levels = object((await native.request('get_available_thinking_levels')).data).levels
    if (!Array.isArray(levels) || !levels.every(level => typeof level === 'string') || !levels.includes(selection.reasoningEffort)) {
      throw new Error('Requested thinking level is unavailable for the selected Jouzu model')
    }
    await native.request('set_thinking_level', { level: selection.reasoningEffort })
  }
  const actual = nativeModelSelection(await native.request('get_state'))
  if (!actual || actual.provider !== selection.provider || actual.model !== selection.model
    || (selection.reasoningEffort !== undefined && actual.reasoningEffort !== selection.reasoningEffort)) {
    throw new Error('Jouzu model state does not match the requested selection')
  }
  return actual
}

/** Read supported thinking levels for the current native model only.
 * @param native - owning native process after selected-state readback.
 * @returns native level identifiers, suitable as verbatim wire labels.
 */
export async function nativeThinkingLevels(native: Pick<JouzuConversation, 'request'>): Promise<string[]> {
  const levels = object((await native.request('get_available_thinking_levels')).data).levels
  if (!Array.isArray(levels)) throw new Error('Invalid Jouzu thinking levels')
  return levels.map(text)
}
