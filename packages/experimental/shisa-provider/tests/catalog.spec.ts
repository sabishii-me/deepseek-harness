import { expect, it } from 'vitest'
import { catalogModels, catalogSchema } from '../src/catalog.ts'
it('maps declared levels, defaults and ingress wire controls', () => {
  const result = catalogModels(catalogSchema.parse({ modelOfferings: [{ modelId: 'qwen', supportedThinkingLevels: ['high', 'off'], defaultThinkingLevel: 'high', compatibilityProfileIds: ['wire'] }], compatibilityProfiles: [{ id: 'wire', appliesTo: 'ingress', projections: { pi: { compat: { thinkingFormat: 'qwen', supportsReasoningEffort: false } } } }] }))
  expect(result.models[0]?.reasoningEfforts).toEqual({ high: 'high', off: 'none' })
  expect(result.models[0]?.compat).toMatchObject({ thinkingFormat: 'qwen', supportsReasoningEffort: false })
  expect(result.defaults.get('qwen')).toBe('high')
})
it('leaves absent declarations inheritable, distinct from explicit nonreasoning', () => {
  const result = catalogModels(catalogSchema.parse({ modelOfferings: [{ modelId: 'unknown' }, { modelId: 'no-reasoning', capabilities: ['streaming'] }] }))
  expect(result.models[0]).not.toHaveProperty('reasoningEfforts')
  expect(result.models[1]?.reasoningEfforts).toBe(false)
})
