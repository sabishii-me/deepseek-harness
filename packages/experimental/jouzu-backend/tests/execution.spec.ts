import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { expect, it, vi } from 'vitest'
import { confineJouzu } from '../src/execution.ts'

it('honors full access and partial providers while refusing absent required services', async () => {
  const ctx = new Context()
  const session = Session.create(SessionId('policy-test'))
  const signal = new AbortController().signal
  try {
    await expect(confineJouzu(ctx, session, ['jouzu'], signal)).rejects.toMatchObject({ code: 'POLICY' })
    let mode = 'danger-full-access'
    ctx.provide('sandboxPolicy', { resolve: () => ({ mode, workspaceRoot: process.cwd() }) })
    expect(await confineJouzu(ctx, session, ['jouzu'], signal)).toMatchObject({ argv: ['jouzu'], mode: 'danger-full-access', enforcement: 'unconfined' })
    mode = 'workspace-write'
    await expect(confineJouzu(ctx, session, ['jouzu'], signal)).rejects.toMatchObject({ code: 'POLICY' })
    ctx.provide('sandbox', { confine: async () => ({ argv: ['wrapped'], enforcement: 'partial' }) })
    expect(await confineJouzu(ctx, session, ['jouzu'], signal)).toMatchObject({ argv: ['wrapped'], enforcement: 'partial', mode: 'workspace-write' })
  } finally { await ctx.fiber.dispose() }
})
it('wraps full argv and refuses subsequent use when the resolved policy changes', async () => {
  const ctx = new Context()
  const session = Session.create(SessionId('policy-test'))
  let mode = 'workspace-write'
  const confine = vi.fn(async () => ({ argv: ['runner', 'jouzu', 'pi', '--mode', 'rpc'], enforcement: 'full' }))
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode, workspaceRoot: process.cwd(), sessionId: session.id }) })
  ctx.provide('sandbox', { confine })
  try {
    const signal = new AbortController().signal
    const execution = await confineJouzu(ctx, session, ['jouzu', 'pi', '--mode', 'rpc'], signal)
    expect(confine).toHaveBeenCalledWith(['jouzu', 'pi', '--mode', 'rpc'], { mode, workspaceRoot: process.cwd(), sessionId: session.id }, signal)
    expect(execution.argv[0]).toBe('runner')
    execution.assertPolicy()
    mode = 'read-only'
    expect(execution.assertPolicy).toThrow('DSH file policy narrowed')
  } finally { await ctx.fiber.dispose() }
})

it('propagates runner failure without falling back to unconfined argv', async () => {
  const ctx = new Context()
  const confine = vi.fn(async () => { throw new Error('runner unavailable') })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only', workspaceRoot: process.cwd() }) })
  ctx.provide('sandbox', { confine })
  try {
    await expect(confineJouzu(ctx, Session.create(SessionId('runner-failure')), ['jouzu'], new AbortController().signal)).rejects.toThrow('runner unavailable')
    expect(confine).toHaveBeenCalledOnce()
  } finally { await ctx.fiber.dispose() }
})
