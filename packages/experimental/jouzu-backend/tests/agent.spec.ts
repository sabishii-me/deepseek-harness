import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { JouzuError } from '../src/error.ts'
import { mountNativeFactory } from '../src/factory-router.ts'
import { externalAgentFactory } from '../src/external-factory.ts'
import Llm, { createUserMessage } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { checkpointProjection } from '../src/checkpoint.ts'
import { bindingProjection } from '../src/binding.ts'
import { JouzuAgent } from '../src/agent.ts'
import type { JouzuRecord, JouzuSink } from '../src/types.ts'

async function fixture(options: { holdPrompt?: boolean; models?: boolean; modelFailure?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(Llm); await ctx.plugin(Sessions); await ctx.plugin(Projections)
  await ctx.plugin(SystemPrompt); await ctx.plugin(Tools); await ctx.plugin(AgentRegistry)
  await mountNativeFactory(ctx)
  ctx.sessionProjections.register(bindingProjection)
  ctx.sessionProjections.register(checkpointProjection)
  let sink!: JouzuSink
  const calls: JouzuRecord[] = []
  const dispose = vi.fn(async () => {})
  const backend = {
    open: vi.fn(async (_options: unknown, observer: JouzuSink) => {
      sink = observer
      return { state: { data: { sessionId: 'native-1', sessionFile: process.cwd() + '/native.jsonl' } }, dispose, respond: vi.fn(), request: async (command: string, fields?: JouzuRecord) => {
        if (options.models) {
          const model = { provider: 'native', id: 'test', name: 'Native Test' }
          if (command === 'get_available_models') return { data: { models: [model] } }
          if (command === 'get_state') return { data: { model, thinkingLevel: 'off' } }
          if (command === 'get_available_thinking_levels') return { data: { levels: ['off'] } }
          if (command === 'set_model') return { data: model }
        }
        if (command === 'get_commands') return { data: { commands: [{ name: 'flow', source: 'extension' }] } }
        if (command === 'prompt' && fields?.message === '/flow') {
          calls.push({ type: command, ...fields })
          sink.event({ type: 'extension_ui_request', method: 'notify', message: 'Flow is paused', notifyType: 'info' })
          return { success: true }
        }
        if (command === 'get_entries') return { type: 'response', data: { entries: [], leafId: null } }
        calls.push({ type: command, ...fields })
        if (command === 'abort') {
          queueMicrotask(() => { sink.event({ type: 'turn_end' }); sink.event({ type: 'agent_settled' }) })
          return { type: 'response', success: true }
        }
        if (options.holdPrompt) {
          queueMicrotask(() => { sink.event({ type: 'agent_start' }); sink.event({ type: 'turn_start' }) })
          return { type: 'response', success: true }
        }
        queueMicrotask(() => {
          sink.event({ type: 'turn_start' })
          sink.event({ type: 'message_start', message: { role: 'assistant' } })
          sink.event({ type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 0 } })
          sink.event({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'native reply' } })
          sink.event({ type: 'message_update', assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'native reply' } })
          sink.event({ type: 'message_end', message: { role: 'assistant', provider: 'native', model: 'test', ...(options.modelFailure ? { stopReason: 'error', errorMessage: 'fixture model failure' } : {}), usage: { input: 10, output: 8, cacheRead: 20, cacheWrite: 0, reasoning: 5, totalTokens: 38 }, content: [{ type: 'text', text: 'native reply' }] } })
          sink.event({ type: 'turn_end' }); sink.event({ type: 'agent_settled' })
        })
        return { type: 'response', success: true }
      } }
    }),
  }
  ctx.provide('jouzuBackend', backend)
  await ctx.plugin({ name: 'external-fixture', inject: ['agents', 'sessions', 'sessionProjections'], apply(owner: Context) {
    owner.agents.setFactory(externalAgentFactory(owner, (context, id, options, session) => new JouzuAgent(context, id, options, session, backend)))
  } })
  return { ctx, backend, calls, dispose, fail: (error: Error) => sink.failure(error), event: (record: JouzuRecord) => sink.event(record) }
}

describe('Jouzu in the existing DSH Agent lifecycle', () => {
  it('uses the standard inbox, Session events and assistant stream for two turns', async () => {
    const f = await fixture()
    try {
      const events: string[] = [], frames: string[] = [], usages: unknown[] = []
      f.ctx.on('session/event', (_session, event) => { events.push(event.type); if (event.type === 'assistant/message') usages.push(event.data.usage) })
      f.ctx.on('agent/assistant-stream', ({ frame }) => { frames.push(frame.type) })
      const handle = await f.ctx.agents.create({ sessionId: SessionId('native-jouzu'), meta: { cwd: process.cwd() }, agentOptions: {} })
      for (const text of ['first', 'second']) {
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
        await handle.agent.whenIdle()
      }
      expect(f.backend.open).toHaveBeenCalledOnce()
      expect(f.calls.map(call => call.message)).toEqual(['first', 'second'])
      expect(events.filter(type => type === 'assistant/message')).toHaveLength(2)
      expect(events.filter(type => type === 'user/message')).toHaveLength(2)
      expect(events.filter(type => type === 'turn/end')).toHaveLength(2)
      expect(frames).toEqual(['start', 'chunk', 'chunk', 'chunk', 'chunk', 'end', 'start', 'chunk', 'chunk', 'chunk', 'chunk', 'end'])
      expect(usages).toEqual(Array(2).fill({ inputTokens: 10, outputTokens: 8, cacheReadTokens: 20, cacheWriteTokens: 0, reasoningTokens: 5, totalTokens: 38 }))
      expect(f.ctx.sessionProjections.stateOf(handle.agent.session, 'jouzuBinding')?.sessionId).toBe('native-1')
      await handle.dispose()
      expect(f.dispose).toHaveBeenCalledOnce()
    } finally { await f.ctx.fiber.dispose() }
  })
  it('reports a post-settlement transport failure and rejects follow-ups as unavailable, not busy', async () => {
    const f = await fixture()
    try {
      const ends: string[] = []
      f.ctx.on('session/event', (_session, event) => { if (event.type === 'turn/end') ends.push(event.data.reason.kind) })
      const handle = await f.ctx.agents.create({ sessionId: SessionId('jouzu-late-failure'), meta: { cwd: process.cwd() }, agentOptions: {} })
      const prompt = () => createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } })
      handle.agent.followup(prompt())
      await handle.agent.whenIdle()
      const failure = new Error('Unsupported native continuation')
      f.fail(failure)
      expect(ends).toEqual(['completed', 'error'])
      expect(handle.agent.status).toBe('idle')
      expect(() => handle.agent.followup(prompt())).toThrow(JouzuError)
      expect(f.calls).toHaveLength(1)
      f.fail(new Error('late exit'))
      expect(ends).toEqual(['completed', 'error'])
      await handle.dispose()
      expect(f.dispose).toHaveBeenCalledOnce()
    } finally { await f.ctx.fiber.dispose() }
  })

  it('keeps native flow context and owns an autonomous turn before accepting another human prompt', async () => {
    const f = await fixture()
    try {
      const events: { type: string; data: unknown }[] = []
      f.ctx.on('session/event', (_session, event) => { events.push(event) })
      const handle = await f.ctx.agents.create({ sessionId: SessionId('jouzu-flow-continuation'), meta: { cwd: process.cwd() }, agentOptions: {} })
      const prompt = () => createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } })
      handle.agent.followup(prompt()); await handle.agent.whenIdle()
      const content = JSON.stringify({ kind: 'work', content: 'Continue task #2' })
      f.event({ type: 'message_end', message: { role: 'custom', customType: 'jouzu-flow', content } })
      f.event({ type: 'agent_start' }); f.event({ type: 'turn_start' })
      expect(handle.agent.status).toBe('running')
      handle.agent.followup(prompt())
      expect(f.calls).toHaveLength(1)
      f.event({ type: 'turn_end' }); f.event({ type: 'agent_settled' })
      await handle.agent.whenIdle()
      expect(f.calls).toHaveLength(2)
      expect(events.filter(event => event.type === 'turn/start')).toHaveLength(3)
      expect(events.filter(event => event.type === 'turn/end')).toHaveLength(3)
      expect(events).toContainEqual(expect.objectContaining({ type: 'user/message', data: expect.objectContaining({
        content: [{ type: 'text', text: content }], source: { kind: 'jouzu-extension', customType: 'jouzu-flow' },
      }) }))
      await handle.dispose()
    } finally { await f.ctx.fiber.dispose() }
  })

  it('disposes a running native turn without ignoring its settlement or hanging the factory', async () => {
    const f = await fixture({ holdPrompt: true })
    try {
      const handle = await f.ctx.agents.create({ sessionId: SessionId('jouzu-dispose-active'), meta: { cwd: process.cwd() }, agentOptions: {} })
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'work' }], source: { kind: 'user' } }))
      await vi.waitFor(() => expect(f.calls).toHaveLength(1))
      await handle.dispose()
      expect(f.calls.map(call => call.type)).toEqual(['prompt', 'abort'])
      expect(f.dispose).toHaveBeenCalledOnce()
      expect(f.ctx.agents.get(handle.agent.id)).toBeUndefined()
    } finally { await f.ctx.fiber.dispose() }
  })

})

it('starts model controls without a prompt, records selection and checkpoints, and excludes concurrent controls', async () => {
  const f = await fixture({ models: true })
  try {
    const handle = await f.ctx.agents.create({ sessionId: SessionId('jouzu-model-controls'), meta: { cwd: process.cwd() }, agentOptions: {} })
    const events: string[] = []
    f.ctx.on('session/event', (_session, event) => { events.push(event.type) })
    const loading = handle.agent.modelControls!.catalog()
    expect(() => handle.agent.modelControls!.catalog()).toThrow('busy')
    const catalog = await loading
    expect(catalog.selected).toEqual({ provider: 'native', model: 'test', reasoningEffort: 'off' })
    expect(catalog.groups[0]?.models[0]?.reasoning?.efforts).toEqual([{ id: 'off', name: 'off' }])
    expect(f.calls).toEqual([])
    expect(events).not.toContain('turn/start')
    expect(events).toEqual(['plugin:jouzu-backend/ui', 'plugin:jouzu-backend/binding', 'model/selection', 'plugin:jouzu-backend/checkpoint'])
    await expect(handle.agent.modelControls!.select({ provider: 'native', model: 'test' })).resolves.toMatchObject({ model: 'test' })
    expect(events.slice(-2)).toEqual(['model/selection', 'plugin:jouzu-backend/checkpoint'])
    await handle.dispose()
  } finally { await f.ctx.fiber.dispose() }
})

it('inspects native Flow only on an existing process without model input or background cancellation', async () => {
  const f = await fixture({ models: true })
  try {
    const handle = await f.ctx.agents.create({ sessionId: SessionId('jouzu-inspect-flow'), meta: { cwd: process.cwd() }, agentOptions: {} })
    await expect((handle.agent as JouzuAgent).inspectFlow()).rejects.toThrow('fresh')
    expect(f.backend.open).not.toHaveBeenCalled()
    await handle.agent.modelControls!.catalog()
    const events: string[] = []
    f.ctx.on('session/event', (_session, event) => { events.push(event.type) })
    await (handle.agent as JouzuAgent).inspectFlow()
    expect(f.calls).toEqual([{ type: 'prompt', message: '/flow' }])
    expect(events).toEqual(['plugin:jouzu-backend/ui'])
    expect(events).not.toContain('user/message')
    await handle.dispose()
  } finally { await f.ctx.fiber.dispose() }
})

it('reads Flow during an active turn without cancelling or settling the turn', async () => {
  const f = await fixture({ holdPrompt: true })
  try {
    const handle = await f.ctx.agents.create({ sessionId: SessionId('jouzu-flow-active'), meta: { cwd: process.cwd() }, agentOptions: {} })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'work' }], source: { kind: 'user' } }))
    await vi.waitFor(() => expect(f.calls).toHaveLength(1))
    expect(handle.agent.status).toBe('running')
    const first = (handle.agent as JouzuAgent).inspectFlow()
    expect((handle.agent as JouzuAgent).inspectFlow()).toBe(first)
    await first
    expect(handle.agent.status).toBe('running')
    expect(f.calls).toEqual([{ type: 'prompt', message: 'work' }, { type: 'prompt', message: '/flow' }])
    await handle.dispose()
  } finally { await f.ctx.fiber.dispose() }
})

it('closes undispatched assistant tool requests before an interrupted step ends', async () => {
  const f = await fixture({ holdPrompt: true })
  try {
    const handle = await f.ctx.agents.create({ sessionId: SessionId('jouzu-interrupted-tool'), meta: { cwd: process.cwd() }, agentOptions: {} })
    const events: { type: string; data: unknown }[] = []
    f.ctx.on('session/event', (_session, event) => { events.push(event) })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'read' }], source: { kind: 'user' } }))
    await vi.waitFor(() => expect(f.calls).toHaveLength(1))
    f.event({ type: 'message_start', message: { role: 'assistant' } })
    f.event({ type: 'message_end', message: { role: 'assistant', provider: 'native', model: 'test', stopReason: 'aborted', content: [{ type: 'toolCall', id: 'unstarted', name: 'read', arguments: { path: 'file' } }] } })
    f.event({ type: 'turn_end' }); f.event({ type: 'agent_settled' })
    await handle.agent.whenIdle()
    const resultIndex = events.findIndex(event => event.type === 'tool/result')
    expect(resultIndex).toBeGreaterThan(-1)
    expect(resultIndex).toBeLessThan(events.findIndex(event => event.type === 'step/end'))
    expect(events[resultIndex]?.data).toMatchObject({ message: { isError: true, source: { callId: 'unstarted' } } })
    await handle.dispose()
  } finally { await f.ctx.fiber.dispose() }
})

it('checkpoints an observed settled model failure before closing its failed turn', async () => {
  const f = await fixture({ modelFailure: true })
  try {
    const handle = await f.ctx.agents.create({ sessionId: SessionId('settled-failure'), meta: { cwd: process.cwd() } })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'fail once' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    const events = handle.agent.session.snapshotEvents()
    const checkpoint = events.findIndex(event => event.type === 'plugin:jouzu-backend/checkpoint')
    expect(checkpoint).toBeGreaterThan(-1)
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'error' } } })
    expect(f.calls.filter(call => call.type === 'prompt')).toHaveLength(1)
    await handle.dispose()
  } finally { await f.ctx.fiber.dispose() }
})
