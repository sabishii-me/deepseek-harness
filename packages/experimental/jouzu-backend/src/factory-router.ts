/** Public factory composition: retain one global Agent registry and isolate only native factory ownership. */
import type { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentFactory, type CreateAgentOptions, type ResumeAgentOptions, type SessionStartSource } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Mount an unmodified native loop with its factory slot isolated from the router.
 * @param owner - plugin lifetime with the global agents service injected.
 * @returns native factory; its public lifecycle methods retain caller ownership.
 */
export async function mountNativeFactory(owner: Context): Promise<AgentFactory> {
  const shared = owner.agents
  class NativeRegistry extends AgentRegistry {
    override enter(agent: Agent, parent: Agent | undefined) { return shared.enter(agent, parent) }
    override announce(agent: Agent, source: SessionStartSource, signal?: AbortSignal) { return shared.announce(agent, source, signal) }
    override register(agent: Agent) { return shared.register(agent) }
    override get(id: SessionId) { return shared.get(id) }
    override list() { return shared.list() }
    override roots() { return shared.roots() }
    override isOwnedBy(id: SessionId, parent: Agent) { return shared.isOwnedBy(id, parent) }
    override create(options: CreateAgentOptions) { return shared.create(options) }
    override resume(options: ResumeAgentOptions) { return shared.resume(options) }
    override currentInitiator() { return shared.currentInitiator() }
    override requireInitiator() { return shared.requireInitiator() }
    override withInitiator<T>(agent: Agent, operation: () => T): T { return shared.withInitiator(agent, operation) }
    override withoutInitiator<T>(operation: () => T): T { return shared.withoutInitiator(operation) }
  }
  const world = owner.isolate('agents')
  await world.plugin(NativeRegistry)
  await world.plugin(AgentLoop, { agents: [] })
  const native = world.get('agentLoop')
  if (!native) throw new Error('Native Agent factory failed to mount')
  return native
}

/** Route creation by the existing preset header; callers supply authoritative resume selection.
 * @param native - unmodified native factory.
 * @param external - independently owned Jouzu factory.
 * @param preset - explicit deployment preset id for Jouzu.
 * @param resumePreset - read the saved effective preset without resuming work.
 * @returns public factory implementation; never silently falls back on external failure.
 */
export function routeFactories(native: AgentFactory, external: AgentFactory, preset: string,
  resumePreset: (options: ResumeAgentOptions) => Promise<string | undefined>): AgentFactory {
  return {
    createAgent: (caller, options) => (options.meta?.agentPreset === preset ? external : native).createAgent(caller, options),
    resume: async (caller, options) => {
      const factory = await resumePreset(options) === preset ? external : native
      return factory.resume(caller, options)
    },
  }
}
