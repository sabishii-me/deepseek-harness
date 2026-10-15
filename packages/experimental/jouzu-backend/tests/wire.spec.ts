import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JouzuWire } from '../src/wire.ts'
import type { Config } from '../src/types.ts'

const config: Config = { argv: ['jouzu'], env: {}, maxRecordBytes: 1024, maxPendingRequests: 2, requestTimeoutMs: 1000, eofGraceMs: 10, terminateGraceMs: 10 }
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers() })
function fixture(overrides: Partial<Config> = {}) {
  const input = new PassThrough()
  const output = new PassThrough()
  const sink = { event: vi.fn(), failure: vi.fn() }
  const sent: Record<string, unknown>[] = []
  input.on('data', chunk => sent.push(JSON.parse(String(chunk))))
  const wire = new JouzuWire(input, output, { ...config, ...overrides }, sink)
  cleanups.push(() => { wire.close(); wire.detach(); input.destroy(); output.destroy() })
  const respond = (index: number, fields = {}) => output.write(JSON.stringify({ type: 'response', id: sent[index]!.id, command: sent[index]!.type, success: true, ...fields }) + '\n')
  return { wire, input, output, sink, sent, respond }
}

describe('Jouzu RPC transport', () => {
  it('correlates out-of-order acknowledgements without ending the conversation', async () => {
    const f = fixture()
    const first = f.wire.request('prompt', { message: 'hello' })
    const second = f.wire.request('get_state')
    f.respond(1); f.respond(0)
    expect((await second).command).toBe('get_state')
    expect((await first).command).toBe('prompt')
    f.output.write('{"type":"agent_settled"}\n{"type":"message_end","message":{"role":"custom","customType":"jouzu-flow"}}\n')
    expect(f.sink.event).toHaveBeenCalledTimes(2)
    const next = f.wire.request('prompt', { message: 'next' }); f.respond(2); await next
  })
  it('preserves fragmented UTF-8, Unicode separators, custom widgets and dialogs', () => {
    const f = fixture()
    const record = { type: 'extension_ui_request', id: 'dialog', method: 'select', title: '日本\u2028語', options: ['allow', 'deny'] }
    const bytes = Buffer.from(JSON.stringify(record) + '\r\n')
    for (const byte of bytes) f.output.write(Buffer.from([byte]))
    expect(f.sink.event).toHaveBeenCalledWith(record)
    f.wire.send({ type: 'extension_ui_response', id: 'dialog', cancelled: true })
    expect(f.sent[0]).toEqual({ type: 'extension_ui_response', id: 'dialog', cancelled: true })
  })
  it('rejects a remote command without terminating later requests', async () => {
    const f = fixture(); const pending = f.wire.request('prompt')
    f.respond(0, { success: false, error: 'denied' })
    await expect(pending).rejects.toMatchObject({ code: 'REMOTE' })
    expect(f.sink.failure).not.toHaveBeenCalled()
    const next = f.wire.request('get_state'); f.respond(1); await next
  })
  it.each(['not-json\n', '[]\n', '{}\n', '{"type":"response","success":true}\n', '{"type":"response","id":"unknown","command":"x","success":true}\n'])('fails pending work on malformed records: %s', async (line) => {
    const f = fixture(); const pending = f.wire.request('get_state')
    f.output.write(line)
    await expect(pending).rejects.toMatchObject({ code: 'PROTOCOL' })
    expect(f.sink.failure).toHaveBeenCalledOnce()
  })
  it('bounds incomplete input records', () => {
    const f = fixture({ maxRecordBytes: 8 })
    f.output.write('12345678')
    expect(f.sink.failure).toHaveBeenCalledWith(expect.objectContaining({ code: 'LIMIT' }))
  })
  it('rejects too many outstanding commands before dispatch', async () => {
    const f = fixture({ maxPendingRequests: 1 }); const first = f.wire.request('get_state')
    await expect(f.wire.request('get_state')).rejects.toMatchObject({ code: 'LIMIT' })
    expect(f.sent).toHaveLength(1); f.respond(0); await first
  })
  it('stops on uncertain command timeout instead of retrying', async () => {
    vi.useFakeTimers()
    const f = fixture(); const pending = f.wire.request('prompt')
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(1000); await assertion
    await expect(f.wire.request('prompt')).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(f.sent).toHaveLength(1)
  })
  it('contains a failed event consumer and rejects pending work', async () => {
    const f = fixture(); const pending = f.wire.request('get_state')
    f.sink.event.mockImplementation(() => { throw new Error('broken renderer bridge') })
    f.output.write('{"type":"agent_start"}\n')
    await expect(pending).rejects.toMatchObject({ code: 'CONSUMER' })
  })
  it('rejects oversized commands without writing them', async () => {
    const f = fixture({ maxRecordBytes: 10 })
    await expect(f.wire.request('prompt')).rejects.toMatchObject({ code: 'LIMIT' })
    expect(f.sent).toHaveLength(0)
  })
})
