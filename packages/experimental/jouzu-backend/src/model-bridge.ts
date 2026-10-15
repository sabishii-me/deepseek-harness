/** Session-owned loopback model transport for independent Jouzu. */
import { z } from 'zod'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import type { Context } from '@deepseek-ai/cordis'
import { type TokenUsage, type FinishReason, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { ModelStreamEncoder } from './model-stream.ts'
import { translateModelRequest } from './model-request.ts'

/** Loopback capability given only to its owning Jouzu subprocess. */
export interface ModelBridge {
  url: string
  token: string
  dispose(): Promise<void>
}

/** Open a bounded text/tool model bridge; selected credentials never enter Jouzu.
 * @param ctx - model-service context.
 * @param selection - capture the authoritative DSH selection for each request.
 * @param limits - deployment-owned request byte/time bounds.
 * @returns authenticated loopback endpoint and draining disposer.
 */
export async function openModelBridge(ctx: Context, selection: () => LlmCallConfig,
  limits: { maxBytes: number; timeoutMs: number }): Promise<ModelBridge> {
  const token = randomUUID()
  const lifetime = new AbortController()
  const pending = new Set<Promise<void>>()
  const server = createServer((request, response) => {
    const run = async (): Promise<void> => {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions' || request.headers.authorization !== `Bearer ${token}` || request.headers.origin !== undefined) {
        response.writeHead(403); response.end(); return
      }
      const disconnected = new AbortController()
      const signal = AbortSignal.any([lifetime.signal, disconnected.signal, AbortSignal.timeout(limits.timeoutMs)])
      const onClose = (): void => { if (!response.writableFinished) disconnected.abort(new Error('Jouzu model connection closed')) }
      const abort = (): void => { request.destroy(); response.destroy() }
      response.on('close', onClose)
      signal.addEventListener('abort', abort, { once: true })
      try {
        let size = 0
        const parts: Buffer[] = []
        for await (const part of request) {
          const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part)
          size += bytes.length
          if (size > limits.maxBytes) throw new Error('Jouzu model input exceeds configured limit')
          parts.push(bytes)
        }
        signal.throwIfAborted()
        const selected = selection()
        const input = translateModelRequest(JSON.parse(Buffer.concat(parts).toString('utf8')), selected, signal)
        const prepared = await ctx.get('llm')!.prepareCall(selected, signal)
        const encoder = new ModelStreamEncoder()
        let usage: TokenUsage | undefined
        let finish: FinishReason | undefined
        const begin = (): void => {
          if (!response.headersSent) response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
        }
        const emit = async (delta: object, finish: string | null = null): Promise<void> => {
          begin()
          const frame = { id: 'dsh-bridge', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'selected', choices: [{ index: 0, delta, finish_reason: finish }] }
          if (!response.write(`data: ${JSON.stringify(frame)}\n\n`)) await once(response, 'drain', { signal })
        }
        let started = false
        // Temporary diagnostic: record the exact chunk order of one request so a stream-shape
        // assumption can be checked against reality instead of inferred.
        const trace: string[] = []
        for await (const chunk of prepared.stream({ ...input, ...prepared.config })) {
          trace.push(chunk.type === 'finish' ? `finish:${JSON.stringify(chunk.reason)}` : chunk.type === 'block-end' ? `block-end:${chunk.block.type}` : chunk.type)
          signal.throwIfAborted()
          if (finish) throw new Error(`Model emitted ${chunk.type} after terminal event; trace=${trace.join('<')}`)
          if (chunk.type === 'finish') {
            finish = chunk.reason
            // An error/aborted finish carries the provider's own failure; surface it instead of a
            // generic 502, otherwise a model-side rejection is indistinguishable from a bridge bug.
            if (finish.kind === 'error' || finish.kind === 'aborted') {
              const failure = 'failure' in finish ? finish.failure : undefined
              throw new Error(`DSH model ${finish.kind}: ${failure === undefined ? 'no detail' : JSON.stringify(failure)}`)
            }
          } else if (chunk.type === 'usage') usage = chunk.usage
          else {
            const deltas = encoder.push(chunk)
            if (deltas.length && !started) { await emit({ role: 'assistant' }); started = true }
            for (const delta of deltas) await emit(delta)
          }
        }
        if (!finish) throw new Error(`Model stream ended without a terminal event; trace=${trace.join('<')}`)
        if (!started) await emit({ role: 'assistant' })
        await emit({}, finish.kind === 'tool-calls' ? 'tool_calls' : finish.kind === 'max-tokens' ? 'length' : 'stop')
        if (usage) {
          const input = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
          const frame = { id: 'dsh-bridge', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'selected', choices: [], usage: { prompt_tokens: input, completion_tokens: usage.outputTokens, ...(usage.reasoningTokens === undefined ? {} : { completion_tokens_details: { reasoning_tokens: usage.reasoningTokens } }), total_tokens: input + usage.outputTokens, prompt_tokens_details: { cached_tokens: usage.cacheReadTokens ?? 0 } } }
          response.write(`data: ${JSON.stringify(frame)}

`)
        }
        response.end('data: [DONE]\n\n')
      } catch (error) {
        const detail = error instanceof z.ZodError
          ? `Unsupported Jouzu request fields: ${error.issues.map(issue => `${issue.path.join('.') || '<root>'}:${issue.code}`).join(', ')}`
          : error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error)
        if (!response.destroyed) {
          if (!response.headersSent) { response.writeHead(502, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: detail } })) }
          else response.destroy()
        }
        ctx.logger.warn('Jouzu model bridge request failed: %s', detail)
      } finally {
        signal.removeEventListener('abort', abort)
        response.off('close', onClose)
      }
    }
    const task = run()
    pending.add(task)
    void task.then(() => pending.delete(task), () => pending.delete(task))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Jouzu bridge failed to acquire loopback port')
  let disposal: Promise<void> | undefined
  return { url: `http://127.0.0.1:${address.port}/v1`, token,
    dispose: () => disposal ??= (async () => {
      lifetime.abort(new Error('Jouzu model bridge disposed'))
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      server.closeAllConnections()
      await Promise.allSettled(pending)
      await closed
    })(),
  }
}
