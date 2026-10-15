import { expect, it } from 'vitest'
import { customUserMessage } from '../src/custom-message.ts'
it('preserves native model context without interpreting embedded instructions', () => {
  const text = JSON.stringify({ kind: 'work', content: 'Continue task #2' })
  const message = customUserMessage({ customType: 'jouzu-flow', content: text })
  expect(message.role).toBe('user')
  expect(message.source).toEqual({ kind: 'jouzu-extension', customType: 'jouzu-flow' })
  expect(message.content).toEqual([{ type: 'text', text }])
})
it.each([
  {}, { customType: '', content: '' }, { customType: 'jouzu-flow', content: {} },
  { customType: 'jouzu-flow', content: [{ type: 'image', data: 'opaque' }] },
])('rejects unsupported native context rather than dropping its content %#', (message) => {
  expect(() => customUserMessage(message)).toThrow()
})
