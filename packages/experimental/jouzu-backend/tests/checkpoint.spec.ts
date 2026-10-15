import { expect, it } from 'vitest'
import { assertCheckpoint, nativeCheckpoint } from '../src/checkpoint.ts'

it('fingerprints native history independent of object property order', () => {
  const a = nativeCheckpoint({ data: { entries: [{ id: 'a', type: 'message', message: { role: 'user', content: 'hello' } }], leafId: 'a' } })
  const b = nativeCheckpoint({ data: { entries: [{ message: { content: 'hello', role: 'user' }, type: 'message', id: 'a' }], leafId: 'a' } })
  expect(a).toEqual(b)
  expect(() => assertCheckpoint(a, b)).not.toThrow()
})
it('refuses changed branches, modified content and missing checkpoint without suggesting replay', () => {
  const first = nativeCheckpoint({ data: { entries: [{ id: 'a', text: 'first' }, { id: 'b', text: 'second' }], leafId: 'b' } })
  const branch = nativeCheckpoint({ data: { entries: [{ id: 'a', text: 'first' }, { id: 'b', text: 'second' }], leafId: 'a' } })
  const edited = nativeCheckpoint({ data: { entries: [{ id: 'a', text: 'changed' }, { id: 'b', text: 'second' }], leafId: 'b' } })
  for (const stored of [null, undefined, branch, edited]) expect(() => assertCheckpoint(stored, first)).toThrow('submission refused')
})
it.each([
  { data: {} },
  { data: { entries: [{ id: 'a' }, { id: 'a' }], leafId: 'a' } },
  { data: { entries: [], leafId: 'missing' } },
  { data: { entries: [{ id: '' }], leafId: null } },
])('rejects malformed native history %#', (response) => {
  expect(() => nativeCheckpoint(response)).toThrow()
})
