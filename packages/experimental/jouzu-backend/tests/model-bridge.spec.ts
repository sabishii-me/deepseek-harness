import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { selectedSessionModel } from '../src/session-model.ts'
import { translateModelRequest } from '../src/model-request.ts'

describe('official Session model selection for independent Jouzu', () => {
  it('captures the picker event and keeps previous requests frozen across a change', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      const pending = ctx.sessions.prepare(SessionId('model-bridge-test'))
      const session = pending
      expect(selectedSessionModel(session, { provider: 'initial', model: 'one' })).toEqual({ provider: 'initial', model: 'one' })
      session.append('model/selection', { provider: 'shisa', model: 'first' })
      const first = selectedSessionModel(session, {})
      session.append('model/selection', { provider: 'other', model: 'second' })
      expect(first).toEqual({ provider: 'shisa', model: 'first' })
      expect(selectedSessionModel(session, {})).toEqual({ provider: 'other', model: 'second' })
    } finally { await ctx.fiber.dispose() }
  })
  it('does not let the process select a different route and rejects lossy image conversion', () => {
    const signal = new AbortController().signal
    const selected = { provider: 'shisa', model: 'selected-by-dsh' }
    const body = { model: 'selected', stream: true, messages: [{ role: 'user', content: 'hello' }] }
    expect(translateModelRequest(body, selected, signal)).toMatchObject(selected)
    expect(() => translateModelRequest({ ...body, model: 'another-provider' }, selected, signal)).toThrow()
    expect(() => translateModelRequest({ ...body, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com' } }] }] }, selected, signal)).toThrow()
  })
  it('preserves tool call correlation and represents returned content as a tool message', () => {
    const options = translateModelRequest({ model: 'selected', stream: true, messages: [
      { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'echo', arguments: '{"value":"ok"}' } }] },
      { role: 'tool', tool_call_id: 'call-1', content: 'ok' },
    ] }, { provider: 'shisa', model: 'one' }, new AbortController().signal)
    expect(options.messages[0]?.content[0]).toMatchObject({ type: 'tool-call', id: 'call-1' })
    expect(options.messages[1]).toMatchObject({ role: 'tool', toolCallId: 'call-1', isError: false })
  })
})
it('preserves Pi replayed reasoning text as a DSH reasoning block', () => {
  const translated = translateModelRequest({ model: 'selected', stream: true, messages: [{ role: 'assistant', content: 'answer', reasoning_content: 'prior reasoning' }] }, { provider: 'shisa', model: 'qwen' }, new AbortController().signal)
  expect(translated.messages[0]?.content).toEqual([{ type:'reasoning',text:'prior reasoning' },{ type:'text',text:'answer' }])
})
