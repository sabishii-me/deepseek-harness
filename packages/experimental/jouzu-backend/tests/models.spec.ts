import { expect, it, vi } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { nativeModelGroups, nativeModelSelection, selectNativeModel } from '../src/models.ts'

const model = { provider: 'native/provider', id: 'model', name: 'Native model' }
it('keeps native identifiers and an actually absent selection', () => {
  expect(nativeModelSelection({ data: {} })).toBeNull()
  expect(nativeModelGroups({ data: { models: [model] } })).toEqual([
    { id: 'native/provider', name: 'native/provider', models: [{ id: 'model', name: 'Native model' }] },
  ])
  expect(() => nativeModelGroups({ data: { models: [model, model] } })).toThrow('Duplicate')
  expect(() => nativeModelSelection({ data: { model: {} } })).toThrow()
})
it('verifies native model and thinking readback rather than echoing the request', async () => {
  const request = vi.fn().mockResolvedValueOnce({ data: { models: [model] } })
    .mockResolvedValueOnce({ data: model }).mockResolvedValueOnce({ data: { levels: ['off', 'high'] } })
    .mockResolvedValueOnce({}).mockResolvedValueOnce({ data: { model, thinkingLevel: 'high' } })
  const selected = { provider: model.provider, model: model.id, reasoningEffort: ReasoningEffortId('high') }
  expect(await selectNativeModel({ request }, selected)).toEqual(selected)
  expect(request.mock.calls.map(call => call[0])).toEqual([
    'get_available_models', 'set_model', 'get_available_thinking_levels', 'set_thinking_level', 'get_state',
  ])
  expect(request).toHaveBeenCalledWith('set_model', { provider: model.provider, modelId: model.id })
})
it('rejects unavailable routes before mutation and mismatched acknowledgements', async () => {
  const request = vi.fn().mockResolvedValue({ data: { models: [] } })
  await expect(selectNativeModel({ request }, { provider: model.provider, model: model.id })).rejects.toThrow('absent')
  expect(request).toHaveBeenCalledOnce()
  request.mockReset().mockResolvedValueOnce({ data: { models: [model] } }).mockResolvedValueOnce({ data: { ...model, id: 'other' } })
  await expect(selectNativeModel({ request }, { provider: model.provider, model: model.id })).rejects.toThrow('different')
})
it('rejects a native thinking level that was not applied', async () => {
  const request = vi.fn().mockResolvedValueOnce({ data: { models: [model] } })
    .mockResolvedValueOnce({ data: model }).mockResolvedValueOnce({ data: { levels: ['high'] } })
    .mockResolvedValueOnce({}).mockResolvedValueOnce({ data: { model, thinkingLevel: 'off' } })
  await expect(selectNativeModel({ request }, { provider: model.provider, model: model.id, reasoningEffort: ReasoningEffortId('high') })).rejects.toThrow('does not match')
})
