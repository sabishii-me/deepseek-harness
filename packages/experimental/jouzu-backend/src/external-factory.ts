/** Plugin-owned external Agent lifecycle over published DSH registries and persistence. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentFactory, AgentHandle, AgentOptions, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import type { Scope } from '@deepseek-ai/dsh-scope'
import { SessionLogOffset, interruptedTurnClosers, type Session, type SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-persistence'

/** The external driver owns only execution and scoped contributions. */
export interface ExternalAgent extends Agent { readonly scope: Scope }
/** Dormant driver constructor; no process or model may run before setup commits. */
export type ExternalAgentConstructor = (ctx: Context, id: SessionId, options: AgentOptions, session: Session) => ExternalAgent

/** Create a lifecycle factory owned by one plugin, without native-loop internals.
 * @param owner - factory owner; its unload cancels and drains admitted lifecycles.
 * @param construct - dormant external driver constructor.
 * @returns factory implementing official create/resume semantics.
 */
export function externalAgentFactory(owner: Context, construct: ExternalAgentConstructor): AgentFactory {
  const lifetime = new AbortController()
  const active = new Set<Promise<AgentHandle>>()
  const handles = new Set<AgentHandle>()
  owner.effect(() => async () => {
    lifetime.abort(new Error('External factory unloaded'))
    await Promise.allSettled(active)
    const results = await Promise.allSettled([...handles].map(handle => handle.dispose()))
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (errors.length) throw new AggregateError(errors, 'External Agent teardown failed')
  })

  async function acquire(caller: Context, options: CreateAgentOptions | ResumeAgentOptions, resume: boolean): Promise<AgentHandle> {
    const admission = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, admission.signal, ...(options.signal ? [options.signal] : [])])
    let stored: SessionHandle | undefined
    let agent: ExternalAgent | undefined
    let detachAgent: (() => void) | undefined
    let detachSession: (() => void) | undefined
    let handle: AgentHandle | undefined
    let disposing: Promise<void> | undefined
    const initialized = Promise.withResolvers<void>()
    const teardown = (): Promise<void> => disposing ??= (async () => {
      admission.abort(new Error('External Agent disposed'))
      await initialized.promise
      const errors: unknown[] = []
      try { agent?.cancel({ kind: 'disposed' }); await agent?.whenIdle() } catch (error) { errors.push(error) }
      try { await agent?.scope.dispose() } catch (error) { errors.push(error) }
      try { await stored?.close() } catch (error) { errors.push(error) }
      try { detachAgent?.() } catch (error) { errors.push(error) }
      try { detachSession?.() } catch (error) { errors.push(error) }
      if (handle) handles.delete(handle)
      if (errors.length) throw new AggregateError(errors, 'External Agent disposal failed')
    })()
    const releaseOwner = caller.effect(() => () => teardown())
    try {
      signal.throwIfAborted()
      let session: Session
      let storedCount = 0
      const persistence = owner.get('sessionPersistence')
      if (resume) {
        const requested = options as ResumeAgentOptions
        if (!persistence) throw new Error('External Agent resume requires Session persistence')
        stored = await persistence.open(requested.resumeSessionId, 'write', { signal })
        signal.throwIfAborted()
        const read = await stored.read(0, undefined, { signal })
        signal.throwIfAborted()
        const closers = interruptedTurnClosers(read.events)
        if (closers.length) await stored.append(closers, { signal })
        storedCount = read.events.length + closers.length
        session = owner.sessions.prepare(requested.resumeSessionId, {
          seed: [...read.events, ...closers], meta: structuredClone(stored.header),
          inheritedEventCount: stored.inheritedEventCount,
        })
      } else {
        const requested = options as CreateAgentOptions
        session = owner.sessions.prepare(requested.sessionId, {
          ...(requested.meta === undefined ? {} : { meta: requested.meta }),
          ...(requested.seed === undefined ? {} : { seed: requested.seed }),
          ...(requested.inheritedEventCount === undefined ? {} : { inheritedEventCount: requested.inheritedEventCount }),
        })
        if (persistence) stored = await persistence.create(session.header, { inheritedEventCount: session.inheritedEventCount, signal })
      }
      signal.throwIfAborted()
      agent = construct(owner, session.id, options.agentOptions ?? {}, session)
      const current = agent
      await current.runMaintenance(async () => {
        const commit = await options.setup?.(current.ctx, current)
        signal.throwIfAborted()
        caller.fiber.assertActive()
        commit?.commit()
        if (stored) {
          const suffix = session.snapshotEvents(SessionLogOffset(storedCount))
          if (suffix.length) await stored.append(suffix, { signal })
        }
        signal.throwIfAborted()
        detachSession = current.ctx.sessions.enter(session)
        detachAgent = owner.agents.enter(current, options.parentAgent)
        current.ctx.sessions.announce(session)
        await owner.agents.announce(current, resume ? 'resume' : 'startup', signal)
        signal.throwIfAborted()
      })
      handle = { agent: current, dispose: async () => { await teardown(); await releaseOwner() } }
      handles.add(handle)
      return handle
    } catch (error) {
      initialized.resolve()
      try { await teardown() } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'External Agent setup and rollback failed')
      } finally { await releaseOwner() }
      throw error
    } finally { initialized.resolve() }
  }
  function start(caller: Context, options: CreateAgentOptions | ResumeAgentOptions, resume: boolean) {
    lifetime.signal.throwIfAborted()
    const operation = acquire(caller, options, resume)
    active.add(operation)
    void operation.then(() => active.delete(operation), () => active.delete(operation))
    return operation
  }
  return {
    createAgent: (caller, options) => start(caller, options, false),
    resume: (caller, options) => start(caller, options, true),
  }
}
