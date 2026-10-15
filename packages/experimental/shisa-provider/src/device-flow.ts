/** Shisa device authorization, independent of Jouzu and its on-disk credentials. */
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'

const httpsUrl = z.string().url().refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash
})
const codeSchema = z.object({
  device_code: z.string().min(1), user_code: z.string().min(1), verification_uri: httpsUrl,
  verification_uri_complete: httpsUrl.optional(), authorization_id: z.string().min(1),
  expires_in: z.number().int().positive().max(86400).default(900),
  interval: z.number().int().positive().max(3600).default(5),
})
/** Validated credential payload stored only on the Host. */
export const grantSchema = z.object({
  api_key: z.object({ uuid: z.string().min(1), secret: z.string().min(1) }),
  org: z.unknown().optional(),
  user: z.unknown().optional(),
  endpoints: z.unknown().optional(),
  link_token: z.string().min(1), authorization_id: z.string().min(1),
})
/** Host-only Shisa grant; never return it through a Remote method. */
export type ShisaGrant = z.infer<typeof grantSchema>
/** Explicit deployment policy and device identity for one real sign-in. */
export interface DeviceFlowOptions {
  gateway: string
  clientVersion: string
  installId: string
  deviceName: string
  platform: string
  requestTimeoutMs: number
  maxResponseBytes: number
  signal: AbortSignal
  notify: (notice: { url: string; code: string }) => void
  commit: (grant: ShisaGrant) => Promise<void>
}

/** Read bounded JSON without including secret response bodies in errors.
 * @param response - provider response.
 * @param maximum - maximum retained bytes.
 * @returns decoded JSON.
 */
export async function readBoundedJson(response: Response, maximum: number): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Shisa returned an empty response')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maximum) throw new Error('Shisa response exceeded the configured limit')
      chunks.push(next.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch (error) {
    // Responses can contain secrets; never propagate JSON parser or body text.
    void error
    await reader.cancel().catch(() => { /* Reader may already be errored. */ })
    throw new Error('Shisa returned an unreadable response')
  } finally { reader.releaseLock() }
}

/** Perform device authorization and durably save the grant before acknowledgement.
 * @param options - validated policy, abort signal, UI notice callback and durable commit owner.
 * @param fetchImpl - HTTP implementation; defaults to the real Host fetch.
 * @returns whether the server confirmed receipt after local persistence.
 */
export async function authorizeShisa(options: DeviceFlowOptions, fetchImpl: typeof fetch = fetch): Promise<{ acknowledged: boolean }> {
  const gateway = httpsUrl.parse(options.gateway).replace(/\/+$/, '')
  const post = async (path: string, data: object | undefined, signal: AbortSignal, token?: string) => {
    try {
      return await fetchImpl(gateway + path, {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}), signal,
      })
    } catch (error) {
      void error
      signal.throwIfAborted()
      throw new Error('Unable to contact Shisa')
    }
  }
  const startSignal = AbortSignal.any([options.signal, AbortSignal.timeout(options.requestTimeoutMs)])
  const response = await post('/device/code', { client_id: 'jouzu', client_version: options.clientVersion,
    install_id: options.installId, device_name: options.deviceName, platform: options.platform }, startSignal).catch((error: unknown) => {
    options.signal.throwIfAborted()
    if (startSignal.aborted) throw new Error(`Shisa device-code request timed out after ${options.requestTimeoutMs / 1000}s; no authorization link was issued. Retry sign-in.`)
    throw error
  })
  if (response.status !== 201) { await response.body?.cancel(); throw new Error(`Shisa sign-in could not start (HTTP ${response.status})`) }
  const parsed = codeSchema.safeParse(await readBoundedJson(response, options.maxResponseBytes))
  if (!parsed.success) throw new Error('Shisa returned an invalid device authorization')
  const code = parsed.data
  const lifetime = AbortSignal.any([options.signal, AbortSignal.timeout(code.expires_in * 1000)])
  options.notify({ url: code.verification_uri_complete ?? code.verification_uri, code: code.user_code })
  let interval = code.interval * 1000
  for (;;) {
    try { await delay(interval, undefined, { signal: lifetime }) }
    catch (error) { options.signal.throwIfAborted(); if (lifetime.aborted) throw new Error('Shisa authorization link expired; start sign-in again'); throw error }
    const requestSignal = AbortSignal.any([lifetime, AbortSignal.timeout(options.requestTimeoutMs)])
    let poll: Response
    try { poll = await post('/device/token', { client_id: 'jouzu', device_code: code.device_code }, requestSignal) }
    catch (error) { lifetime.throwIfAborted(); void error; continue }
    if (poll.status >= 500 || poll.status === 408 || poll.status === 429) {
      await poll.body?.cancel()
      if (poll.status === 429) interval = Math.min(Math.max(interval, 1000) * 2, 60000)
      continue
    }
    const data = await readBoundedJson(poll, options.maxResponseBytes)
    if (poll.status === 200) {
      const grant = grantSchema.safeParse(data)
      if (!grant.success) {
        const fields = [...new Set(grant.error.issues.map(issue => issue.path.join('.')))].join(', ')
        throw new Error(`Shisa returned an invalid authorization grant (fields: ${fields}); no credentials were saved`)
      }
      if (grant.data.authorization_id !== code.authorization_id) throw new Error('Shisa authorization identity mismatch; no credentials were saved')
      lifetime.throwIfAborted()
      await options.commit(grant.data)
      // After commit cancellation or failed ack does not mean the credential vanished.
      try {
        const ack = await post('/device/link/ack', undefined, AbortSignal.any([options.signal, AbortSignal.timeout(options.requestTimeoutMs)]), grant.data.link_token)
        await ack.body?.cancel()
        return { acknowledged: ack.status === 204 }
      } catch (error) { void error; return { acknowledged: false } }
    }
    const result = z.object({ error: z.union([z.string(), z.object({ code: z.string() }).transform(error => error.code)]), interval: z.number().positive().optional() }).safeParse(data)
    if (result.success && result.data.error === 'authorization_pending') continue
    if (result.success && result.data.error === 'slow_down') { interval = Math.max(interval, (result.data.interval ?? 0) * 1000) + 5000; continue }
    throw new Error(`Shisa authorization was refused or expired (HTTP ${poll.status}); start sign-in again`)
  }
}
