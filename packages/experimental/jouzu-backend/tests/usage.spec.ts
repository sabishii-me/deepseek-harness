import { expect, it } from 'vitest'
import { jouzuUsage } from '../src/usage.ts'
const usage = { input: 10, output: 8, cacheRead: 20, cacheWrite: 2, totalTokens: 40 }
it('preserves reasoning as a subset of output and includes cache in total only once', () => {
  expect(jouzuUsage({ ...usage, reasoning: 5 })).toEqual({ inputTokens: 10, outputTokens: 8, cacheReadTokens: 20, cacheWriteTokens: 2, totalTokens: 40, reasoningTokens: 5 })
})
it('does not invent reasoning usage from text length or missing fields', () => {
  expect(jouzuUsage(usage)).not.toHaveProperty('reasoningTokens')
  expect(jouzuUsage({ ...usage, reasoning: 0 })).toHaveProperty('reasoningTokens', 0)
  expect(jouzuUsage({ ...usage, reasoning: 9 })).not.toHaveProperty('reasoningTokens')
})
it.each([undefined, null, [], {}, { ...usage, input: -1 }, { ...usage, output: 1.5 }, { ...usage, cacheRead: Number.MAX_SAFE_INTEGER }])('omits unusable native accounting %#', (value) => {
  expect(jouzuUsage(value)).toBeUndefined()
})
