/** Session-bound HTTP transport for public DSH tools called by an independent Pi extension. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-sandbox-policy'

const invocation = z.object({ callId: z.string().min(1), name: z.string().min(1), arguments: z.unknown() }).strict()

/**
 * Argument fields a confined call may not carry, matched loosely because they
 * sit among tool-specific arguments this layer does not otherwise model.
 * `sandbox_permissions` would widen the policy the Session was started under,
 * and a background flag asks the host to own a process that outlives the call —
 * neither is representable in a request/response bridge.
 */
const escalationArguments = z.looseObject({
  sandbox_permissions: z.unknown().optional(),
  run_in_background: z.unknown().optional(),
})

/** Open a capability scoped to exactly one Agent and an explicit set of DSH tool names.
 * @param owner - plugin context with agents/tools services injected.
 * @param agent - owning live Agent; neither identity nor scope comes from HTTP input.
 * @param names - admitted tool names; visibility is checked again on every invocation.
 * @param maxBytes - maximum serialized invocation size.
 * @param restricted - permit only foreground PowerShell and write without escalation.
 * @returns endpoint credentials and a disposer that cancels and drains execution.
 */
export async function openToolBridge(owner: Context, agent: Agent, names: readonly string[], maxBytes: number, restricted = false) {
  const token = randomUUID()
  const allowed = new Set(names)
  const lifetime = new AbortController()
  const pending = new Set<Promise<void>>()
  const calls = new Set<string>()
  const server = createServer((request, response) => {
    const operation = async () => {
      if (request.headers.authorization !== `Bearer ${token}` || request.headers.origin !== undefined) {
        response.writeHead(403).end(); return
      }
      const disconnected = new AbortController()
      const signal = AbortSignal.any([lifetime.signal, disconnected.signal])
      const close = () => { if (!response.writableFinished) disconnected.abort(new Error('Tool bridge disconnected')) }
      response.on('close', close)
      const reply = (status: number, value: object) => {
        if (!response.destroyed) response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
      }
      try {
        if (request.method === 'GET' && request.url === '/tools') {
          reply(200, { tools: owner.tools.schemas(agent).filter(tool => allowed.has(tool.name)) }); return
        }
        if (request.method !== 'POST' || request.url !== '/execute') { response.writeHead(404).end(); return }
        let size = 0
        const parts: Buffer[] = []
        for await (const part of request) {
          const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part)
          size += bytes.length
          if (size > maxBytes) { reply(413, { error: 'Tool invocation exceeds configured limit' }); return }
          parts.push(bytes)
        }
        const input = invocation.parse(JSON.parse(Buffer.concat(parts).toString('utf8')))
        signal.throwIfAborted()
        if (restricted) {
          const mode = owner.get('sandboxPolicy')?.resolve({ session: agent.session }).mode
          if (mode !== 'workspace-write' && mode !== 'read-only') { reply(403, { error: 'Restricted policy changed; start a new Session' }); return }
          // Two argument shapes are refused by name, because both leave the
          // confinement the session was started under: `sandbox_permissions`
          // asks for a WIDER policy, and background flags ask the host to own a
          // persistent process, which the request/response bridge cannot model.
          // Every other argument passes through to the host tool schema.
          const escalation = escalationArguments.safeParse(input.arguments)
          if (escalation.success
            && (escalation.data.sandbox_permissions !== undefined || escalation.data.run_in_background === true)) {
            reply(403, { error: 'Escalation and background arguments are outside the confined tool scope' }); return
          }
        }
        if (!allowed.has(input.name) || !owner.tools.get(input.name, agent)) {
          reply(403, { error: 'Tool is not exposed to this Jouzu Session' }); return
        }
        // A lost HTTP response must never turn a transport retry into a second side effect.
        if (calls.has(input.callId)) { reply(409, { error: 'Tool call already admitted; automatic replay refused' }); return }
        calls.add(input.callId)
        const result = await owner.agents.withInitiator(agent, () => owner.tools.execute({
          agent, callId: ToolCallId(input.callId), name: input.name, arguments: input.arguments, signal,
        }))
        reply(200, result)
      } catch (error) {
        reply(400, { error: error instanceof Error ? error.message : String(error) })
      } finally { response.off('close', close) }
    }
    const task = operation()
    pending.add(task)
    void task.finally(() => pending.delete(task)).catch(() => { response.destroy() })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Tool bridge has no listening address')
  let disposal: Promise<void> | undefined
  return {
    url: `http://127.0.0.1:${address.port}`, token,
    dispose: () => disposal ??= (async () => {
      lifetime.abort(new Error('Tool bridge disposed'))
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      server.closeAllConnections()
      await Promise.allSettled(pending)
      await closed
    })(),
  }
}
