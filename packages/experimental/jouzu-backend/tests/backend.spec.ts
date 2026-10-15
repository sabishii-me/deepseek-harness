import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import JouzuBackend from '../src/index.ts'
import type { Config } from '../src/types.ts'

const config: Config = { argv: ['node', '/jouzu/cli.js'], env: {}, maxRecordBytes: 1024, maxPendingRequests: 4, requestTimeoutMs: 1000, eofGraceMs: 10, terminateGraceMs: 10 }

const session = () => Session.create(SessionId('execution-test'), [], { version: SESSION_FORMAT_VERSION, id: SessionId('execution-test'), createdAt: Date.now(), isSeeded: false, cwd: process.cwd() })

async function fixture(options: { confinement?: Promise<void>; enforcement?: 'full' | 'partial'; reply?: boolean; credentials?: boolean } = {}) {
  let mode = 'workspace-write'
  const ctx = new Context()
  const stdin = new PassThrough(); const stdout = new PassThrough()
  let exit!: () => void
  const done = new Promise<{ exitCode: number; signal: null }>((resolve) => { exit = () => resolve({ exitCode: 0, signal: null }) })
  const terminate = vi.fn(() => exit())
  const waitForExit = vi.fn(async () => { await done; return true })
  const spawn = vi.fn(() => ({ stdin, stdout, stderr: undefined, control: undefined, collected: {}, done, terminate, waitForExit }))
  ctx.provide('subprocess', { spawn })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode, workspaceRoot: process.cwd(), sessionId: SessionId('execution-test') }) })
  ctx.provide('sandbox', { confine: async (argv: readonly string[]) => { await options.confinement; return { argv: ['sandbox-runner', ...argv], enforcement: options.enforcement ?? 'full' } } })
  stdin.on('data', (chunk) => {
    const record = JSON.parse(String(chunk))
    if (record.type === 'extension_ui_response' || options.reply === false) return
    stdout.write(JSON.stringify({ type: 'response', id: record.id, command: record.type, success: true, data: { sessionId: 'native-1' } }) + '\n')
  })
  stdin.on('finish', exit)
  if (options.credentials) ctx.provide('credentials', { resolve: async () => ({ value: 'TEST-SECRET' }) })
  // A confined session (the fixture's default workspace-write) always routes
  // tools through the bridge, so the default fixture supplies one unless a case
  // overrides it explicitly.
  const defaultBridge = options.toolBridge === undefined
    ? async () => ({ url: 'http://127.0.0.1:12345', token: 'test-capability', dispose: async () => {} })
    : options.toolBridge
  const plugin = ctx.plugin(JouzuBackend, { ...config, ...(options.credentials ? { credentialEnv: { SHISA_API_KEY: 'SHISA_API_KEY' } } : {}) })
  await plugin
  return { ctx, plugin, spawn, stdout, terminate, waitForExit, defaultBridge, changeMode: (value: string) => { mode = value } }
}

describe('Jouzu backend ownership', () => {
  it('retains one native process across turns and settlement; EOF disposal joins it', async () => {
    const f = await fixture()
    try {
      const sink = { event: vi.fn(), failure: vi.fn() }
      const conversation = await f.ctx.jouzuBackend.open({ session: session(), cwd: process.cwd(), toolBridge: f.defaultBridge }, sink)
      await conversation.request('prompt', { message: 'first' })
      f.stdout.write('{"type":"agent_settled"}\n')
      await conversation.request('prompt', { message: 'second' })
      expect(f.spawn).toHaveBeenCalledOnce()
      expect(f.terminate).not.toHaveBeenCalled()
      expect(sink.event).toHaveBeenCalledWith({ type: 'agent_settled' })
      await conversation.dispose(); await conversation.dispose()
      expect(f.waitForExit).toHaveBeenCalledOnce()
      expect(sink.failure).not.toHaveBeenCalled()
      await expect(conversation.request('get_state')).rejects.toMatchObject({ code: 'CLOSED' })
    } finally { await f.ctx.fiber.dispose() }
  })
  it('passes native resume identity and rolls down active conversations on unload', async () => {
    const f = await fixture()
    try {
      await f.ctx.jouzuBackend.open({ session: session(), cwd: process.cwd(), sessionFile: process.cwd() + '/native.jsonl', toolBridge: f.defaultBridge }, { event: vi.fn(), failure: vi.fn() })
      // The bridge extension lives in a per-process temp directory, so the argv
      // is asserted by its stable head and tail rather than by identity.
      const argv = (f.spawn.mock.calls[0]![0] as { argv: string[] }).argv
      expect(argv.slice(0, 4)).toEqual(['sandbox-runner', ...config.argv, 'pi'])
      expect(argv).toContain('--mode')
      expect(argv).toContain('rpc')
      expect(argv[argv.indexOf('--exclude-tools') + 1]).toBe('bg_task,subagent')
      expect(argv.slice(-2)).toEqual(['--session', process.cwd() + '/native.jsonl'])
      await f.plugin.dispose()
      expect(f.waitForExit).toHaveBeenCalledOnce()
    } finally { await f.ctx.fiber.dispose() }
  })
  it('revokes an idle native process immediately on its own Session policy change', async () => {
    const f = await fixture()
    try {
      const owner = session()
      const sink = { event: vi.fn(), failure: vi.fn() }
      const conversation = await f.ctx.jouzuBackend.open({ session: owner, cwd: process.cwd(), toolBridge: f.defaultBridge }, sink)
      f.changeMode('read-only')
      const event = owner.append('sandbox/mode', { mode: 'read-only' })
      f.ctx.emit('session/event', owner, event)
      expect(f.terminate).toHaveBeenCalledOnce()
      expect(sink.failure).toHaveBeenCalledWith(expect.objectContaining({ code: 'POLICY' }))
      await expect(conversation.request('prompt', { message: 'must not be sent' })).rejects.toMatchObject({ code: 'POLICY' })
      await conversation.dispose()
    } finally { await f.ctx.fiber.dispose() }
  })

  it('does not revoke another Session or react to unrelated events', async () => {
    const f = await fixture()
    try {
      const owner = session(), other = session()
      const sink = { event: vi.fn(), failure: vi.fn() }
      const conversation = await f.ctx.jouzuBackend.open({ session: owner, cwd: process.cwd(), toolBridge: f.defaultBridge }, sink)
      f.ctx.emit('session/event', other, other.append('sandbox/mode', { mode: 'read-only' }))
      f.ctx.emit('session/event', owner, owner.append('turn/start', { turn: 1 }))
      expect(f.terminate).not.toHaveBeenCalled()
      await conversation.dispose()
      f.changeMode('read-only')
      f.ctx.emit('session/event', owner, owner.append('sandbox/mode', { mode: 'read-only' }))
      expect(sink.failure).not.toHaveBeenCalled()
    } finally { await f.ctx.fiber.dispose() }
  })

  it('never spawns after unload wins asynchronous confinement', async () => {
    const gate = Promise.withResolvers<void>()
    const f = await fixture({ confinement: gate.promise })
    try {
      const opening = f.ctx.jouzuBackend.open({ session: session(), cwd: process.cwd(), toolBridge: f.defaultBridge }, { event: vi.fn(), failure: vi.fn() })
      const rejected = expect(opening).rejects.toThrow('unloaded during startup')
      const disposal = f.plugin.dispose()
      gate.resolve()
      await rejected
      await disposal
      expect(f.spawn).not.toHaveBeenCalled()
    } finally { gate.resolve(); await f.ctx.fiber.dispose() }
  })

  it('uses partial confinement without replacing the wrapped command', async () => {
    const f = await fixture({ enforcement: 'partial' })
    try {
      const conversation = await f.ctx.jouzuBackend.open({ session: session(), cwd: process.cwd(), toolBridge: f.defaultBridge }, { event: vi.fn(), failure: vi.fn() })
      const argv = (f.spawn.mock.calls[0]![0] as { argv: string[] }).argv
      expect(argv.slice(0, 4)).toEqual(['sandbox-runner', ...config.argv, 'pi'])
      expect(argv[argv.indexOf('--exclude-tools') + 1]).toBe('bg_task,subagent')
      await conversation.dispose()
    } finally { await f.ctx.fiber.dispose() }
  })

  it('cancels unpublished startup while waiting for get_state, joining the process', async () => {
    const f = await fixture({ reply: false })
    try {
      const controller = new AbortController()
      const sink = { event: vi.fn(), failure: vi.fn() }
      const opening = f.ctx.jouzuBackend.open({ session: session(), cwd: process.cwd(), signal: controller.signal, toolBridge: f.defaultBridge }, sink)
      const rejected = expect(opening).rejects.toThrow('startup cancelled')
      await vi.waitFor(() => expect(f.spawn).toHaveBeenCalledOnce())
      controller.abort(new Error('stop requested'))
      await rejected
      expect(f.terminate).toHaveBeenCalledOnce()
      expect(f.waitForExit).toHaveBeenCalled()
    } finally { await f.ctx.fiber.dispose() }
  })

  it('releases the startup signal after publication instead of killing a caller-owned conversation', async () => {
    const f = await fixture()
    try {
      const controller = new AbortController()
      const conversation = await f.ctx.jouzuBackend.open({ session: session(), cwd: process.cwd(), signal: controller.signal, toolBridge: f.defaultBridge }, { event: vi.fn(), failure: vi.fn() })
      controller.abort()
      await conversation.request('get_state')
      expect(f.terminate).not.toHaveBeenCalled()
      await conversation.dispose()
    } finally { await f.ctx.fiber.dispose() }
  })

})

it('forwards only explicit credential references and revokes the process when they change', async () => {
  const f = await fixture({ credentials: true })
  try {
    const sink = { event: vi.fn(), failure: vi.fn() }
    const conversation = await f.ctx.jouzuBackend.open({ session: session(), cwd: process.cwd(), toolBridge: f.defaultBridge }, sink)
    expect(f.spawn).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        SHISA_API_KEY: 'TEST-SECRET',
      }),
    }))
    f.ctx.emit('credentials/reference-updated', 'SHISA_API_KEY' as import('@deepseek-ai/dsh-credentials').CredentialRef)
    expect(f.terminate).toHaveBeenCalledOnce()
    await conversation.dispose()
  } finally { await f.ctx.fiber.dispose() }
})

it('loads the public tool extension and releases its bridge with the conversation', async () => {
  const f = await fixture()
  const dispose = vi.fn(async () => {})
  try {
    const conversation = await f.ctx.jouzuBackend.open({ session:session(),cwd:process.cwd(),toolBridge:async()=>({ url:'http://127.0.0.1:12345',token:'test-capability',dispose }) },{ event:vi.fn(),failure:vi.fn() })
    expect(f.spawn.mock.calls[0]).toEqual([expect.objectContaining({
      argv:expect.arrayContaining(['--extension']),
      env:expect.objectContaining({ DSH_TOOL_BRIDGE_URL:'http://127.0.0.1:12345',DSH_TOOL_BRIDGE_TOKEN:'test-capability' }),
    })])
    expect(dispose).not.toHaveBeenCalled()
    await conversation.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  } finally {await f.ctx.fiber.dispose()}
})

it('releases the opened tool bridge when confinement fails before spawn', async () => {
  const gate = Promise.withResolvers<void>()
  void gate.promise.catch(() => { /* The opening operation asserts this rejection after async extension creation. */ })
  const f = await fixture({ confinement:gate.promise })
  const dispose = vi.fn(async () => {})
  try {
    const opening=f.ctx.jouzuBackend.open({ session:session(),cwd:process.cwd(),toolBridge:async()=>({ url:'http://127.0.0.1:12345',token:'test-capability',dispose }) },{ event:vi.fn(),failure:vi.fn() })
    const rejected=expect(opening).rejects.toThrow('test runner failure')
    gate.reject(new Error('test runner failure'))
    await rejected
    expect(dispose).toHaveBeenCalledOnce()
    expect(f.spawn).not.toHaveBeenCalled()
  } finally {await f.ctx.fiber.dispose()}
})
