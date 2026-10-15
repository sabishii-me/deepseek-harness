import { afterEach, expect, it, vi } from 'vitest'
import { authorizeShisa, type DeviceFlowOptions } from '../src/device-flow.ts'
afterEach(() => vi.useRealTimers())
const grant = { api_key: { uuid: 'key-id', secret: 'PRIVATE-KEY' }, org: { id: 'org', name: 'Org', slug: 'org' }, user: { email: 'user@example.test' }, endpoints: { openai_base_url: 'https://api.example.test/v1', model_catalog_url: 'https://api.example.test/catalog', asr_realtime_url: 'wss://api.example.test/asr' }, link_token: 'PRIVATE-LINK', authorization_id: 'auth-id' }
const code = { device_code: 'PRIVATE-DEVICE', user_code: 'USER-CODE', verification_uri: 'https://login.example.test/verify', authorization_id: 'auth-id', interval: 1, expires_in: 15 }
function options(): DeviceFlowOptions {
  return { gateway: 'https://gateway.example.test', clientVersion: 'dsh-test', installId: 'install', deviceName: 'device', platform: 'test', requestTimeoutMs: 10000, maxResponseBytes: 65536, signal: new AbortController().signal, notify: vi.fn(), commit: vi.fn(async () => {}) }
}
it('uses jouzu client identity and commits secrets before acknowledging delivery', async () => {
  vi.useFakeTimers()
  const opts = options()
  const events: string[] = []
  opts.commit = async (value) => { expect(value).toEqual(grant); events.push('commit') }
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/device/code')) {
      expect(JSON.parse(String(init?.body)).client_id).toBe('jouzu')
      return Response.json(code, { status: 201 })
    }
    if (String(url).endsWith('/device/token')) return Response.json(grant)
    events.push('ack')
    expect(init?.headers).toMatchObject({ authorization: 'Bearer PRIVATE-LINK' })
    return new Response(null, { status: 204 })
  })
  const run = authorizeShisa(opts, fetchImpl)
  await vi.advanceTimersByTimeAsync(1100)
  await expect(run).resolves.toEqual({ acknowledged: true })
  expect(events).toEqual(['commit', 'ack'])
  expect(opts.notify).toHaveBeenCalledWith({ url: code.verification_uri, code: 'USER-CODE' })
})
it('does not acknowledge when credential persistence fails', async () => {
  vi.useFakeTimers()
  const opts = options(); opts.commit = async () => { throw new Error('storage failed') }
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(code, { status: 201 })).mockResolvedValueOnce(Response.json(grant))
  const run = authorizeShisa(opts, fetchImpl)
  const assertion = expect(run).rejects.toThrow('storage failed')
  await vi.advanceTimersByTimeAsync(1100); await assertion
  expect(fetchImpl).toHaveBeenCalledTimes(2)
})
it('reports unconfirmed acknowledgement separately after persistence', async () => {
  vi.useFakeTimers()
  const opts = options()
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(code, { status: 201 })).mockResolvedValueOnce(Response.json(grant)).mockResolvedValueOnce(new Response(null, { status: 503 }))
  const run = authorizeShisa(opts, fetchImpl)
  await vi.advanceTimersByTimeAsync(1100)
  await expect(run).resolves.toEqual({ acknowledged: false })
  expect(opts.commit).toHaveBeenCalledOnce()
})
it('rejects mismatched grants without committing or exposing secret fields', async () => {
  vi.useFakeTimers()
  const opts = options()
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(code, { status: 201 })).mockResolvedValueOnce(Response.json({ ...grant, authorization_id: 'other' }))
  const run = authorizeShisa(opts, fetchImpl)
  const assertion = expect(run).rejects.toThrow('authorization identity mismatch')
  await vi.advanceTimersByTimeAsync(1100); await assertion
  expect(opts.commit).not.toHaveBeenCalled()
})
it('cancels polling without issuing a grant request', async () => {
  const opts = options(); const controller = new AbortController(); opts.signal = controller.signal
  opts.notify = () => controller.abort(new Error('cancelled'))
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(code, { status: 201 }))
  await expect(authorizeShisa(opts, fetchImpl)).rejects.toThrow()
  expect(fetchImpl).toHaveBeenCalledOnce()
  expect(opts.commit).not.toHaveBeenCalled()
})
it('keeps polling for the gateway nested authorization_pending response', async () => {
  vi.useFakeTimers()
  const opts = options()
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(code, { status: 201 }))
    .mockResolvedValueOnce(Response.json({ error: { code: 'authorization_pending' } }, { status: 400 }))
    .mockResolvedValueOnce(Response.json(grant))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  const run = authorizeShisa(opts, fetchImpl)
  await vi.advanceTimersByTimeAsync(2100)
  await expect(run).resolves.toEqual({ acknowledged: true })
  expect(opts.commit).toHaveBeenCalledOnce()
})
it('commits login without model endpoints, model catalog or organization metadata', async () => {
  vi.useFakeTimers()
  const opts = options()
  const authorization = { api_key: grant.api_key, link_token: grant.link_token, authorization_id: grant.authorization_id }
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(code, { status: 201 }))
    .mockResolvedValueOnce(Response.json(authorization))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  const run = authorizeShisa(opts, fetchImpl)
  await vi.advanceTimersByTimeAsync(1100)
  await expect(run).resolves.toEqual({ acknowledged: true })
  expect(opts.commit).toHaveBeenCalledWith(authorization)
  expect(fetchImpl).toHaveBeenCalledTimes(3)
})
