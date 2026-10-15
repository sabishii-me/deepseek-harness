/** Independent Shisa authorization owner. Does not import or modify Jouzu. */
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createModelGeneration, type ModelGeneration } from './models.ts'
import { catalogModels, catalogSchema } from './catalog.ts'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import type { ShisaStatus } from './types.ts'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-authorization'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { z as json } from 'zod'
import { authorizeShisa, grantSchema, readBoundedJson } from './device-flow.ts'

/** Deployment policy for the Shisa device service. */
export interface Config {
  gateway: Volatile<string>
  clientVersion: string
  requestTimeoutMs: number
  maxResponseBytes: number
}
/** Credential address owned exclusively by this plugin. */
export const SHISA_CREDENTIAL = credentialKey('shisa-provider', 'account')
const INSTALL_ID = credentialKey('shisa-provider', 'installation')

/** Registers the real Shisa device flow through DSH's authorization service. */
export default class ShisaProvider extends TypertRemoteService {
  static inject = ['authorization', 'credentials', 'llm', 'typert']
  static Config = z.object({
    gateway: z.string().default('https://gateway.shisa.ai').volatile(),
    clientVersion: z.string().default('dsh/0.2.1-alpha.2'),
    requestTimeoutMs: z.natural().min(1).max(2_147_483_647).default(30000),
    maxResponseBytes: z.natural().min(1).default(1048576),
  })
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'shisaProvider', { namespace: 'shisa' })
    this.runtime = { ctx }
    ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
    const gateway = new URL(config.gateway.get())
    if (gateway.protocol !== 'https:' || gateway.username || gateway.password || gateway.search || gateway.hash) throw new Error('Shisa gateway must be an HTTPS URL without credentials, query or fragment')
    ctx.llm.registerConfigurableProviders([{ provider: 'shisa', displayName: 'Shisa', settingsNs: ctx.fiber.entry?.options.id ?? 'shisa-provider', settingsPath: [] }])
    this.initialization = this.restoreAccount()
    ctx.effect(() => () => { this.lifetime.abort(); return Promise.allSettled([this.initialization, ...(this.active ? [this.active] : []), ...(this.catalogTask ? [this.catalogTask] : [])]) })
    ctx.effect(() => ctx.authorization.registerFlow({
      key: SHISA_CREDENTIAL, label: 'Shisa', methods: [{ id: 'device', label: 'Sign in with Shisa' }],
      run: async (session) => {
        const identity = await ctx.credentials.modifyRecord(INSTALL_ID, current => Promise.resolve(current ?? { kind: 'grant', payload: { id: randomUUID() } }))
        if (identity?.kind !== 'grant' || !identity.payload || typeof identity.payload !== 'object' || !('id' in identity.payload) || typeof identity.payload.id !== 'string') throw new Error('Stored Shisa installation identity is invalid')
        const result = await authorizeShisa({ ...config, gateway: config.gateway.get(), installId: identity.payload.id, deviceName: hostname(), platform: `${process.platform}-${process.arch}`,
          signal: session.signal,
          notify: ({ url, code }) => session.notify({ message: 'Authorize this device on Shisa to continue.', url, code }),
          commit: async (grant) => {
            await session.commit({ kind: 'grant', payload: { ...grant, gateway: gateway.href } })
            this.status = { phase: 'ready', modelCount: 0, catalogPhase: 'idle' }
          },
        })
        if (!result.acknowledged) this.runtime.ctx.logger.warn('Shisa credentials saved; receipt acknowledgement pending')
      },
    }))
  }
  private readonly runtime: { ctx: Context }
  private retiredModels: ModelGeneration[] = []
  private models: ModelGeneration | undefined
  private registration: AdapterRegistrationHandle | undefined
  private status: ShisaStatus = { phase: 'signed-out', modelCount: 0 }
  private readonly lifetime = new AbortController()
  private catalogTask: Promise<void> | undefined
  private active: Promise<void> | undefined
  private initialization: Promise<void> = Promise.resolve()

  /** Read account status without exposing credentials.
   * @returns current authorization and catalog status.
   */
  @Remote
  async getState(): Promise<ShisaStatus> {
    await this.initialization
    return { ...this.status }
  }

  /** Start one real device authorization; the caller polls secret-free status.
   * @returns once the attempt is admitted.
   */
  @Remote
  async signIn(): Promise<void> {
    await this.initialization
    if (this.active) throw new Error('Shisa sign-in already running')
    if (this.status.phase === 'ready') throw new Error('Already signed in')
    this.status = { phase: 'waiting', modelCount: 0 }
    const started = Date.now()
    this.runtime.ctx.logger.info('Shisa authorization started; per-request timeout=%d ms', this.config.requestTimeoutMs)
    const task = this.runtime.ctx.authorization.begin({ key: SHISA_CREDENTIAL, signal: this.lifetime.signal,
      interaction: { notify: (notice) => { this.runtime.ctx.logger.info('Shisa device code issued after %d ms; waiting for approval', Date.now() - started); this.status = { phase: 'waiting', modelCount: 0, ...notice } }, prompt: async () => { throw new Error('Unexpected Shisa prompt') } },
    }).then(async (result) => {
      if (result.status === 'authorized') { this.runtime.ctx.logger.info('Shisa authorization committed after %d ms', Date.now() - started); this.status = { phase: 'ready', modelCount: 0, catalogPhase: 'idle' }; this.startCatalog() }
      else this.status = { phase: 'signed-out', modelCount: 0 }
    }).catch((error: unknown) => { this.runtime.ctx.logger.warn('Shisa sign-in failed after %d ms (%s)', Date.now() - started, error instanceof Error ? error.name : 'unknown'); this.status = { phase: 'error', modelCount: 0, message: error instanceof Error ? error.message : 'Shisa sign-in failed' } })
      .finally(() => { this.active = undefined })
    this.active = task
  }

  /** Cancel the active device authorization.
   * @returns after its work has settled.
   */
  @Remote
  async cancel(): Promise<void> { this.runtime.ctx.authorization.cancel(SHISA_CREDENTIAL); await this.active }

  /** Revoke the saved Shisa device before deleting its credential.
   * @returns after server revocation and local credential removal.
   */
  @Remote
  async signOut(): Promise<void> {
    await this.cancel()
    await this.catalogTask
    const record = await this.runtime.ctx.credentials.readRecord(SHISA_CREDENTIAL)
    if (record?.kind === 'grant') {
      const grant = grantSchema.parse(record.payload)
      const response = await fetch(this.config.gateway.get().replace(/\/+$/, '') + '/device/link/revoke', {
        method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${grant.link_token}` },
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.config.requestTimeoutMs)]),
      })
      await response.body?.cancel()
      if (response.status !== 204) throw new Error(`Shisa revocation failed (HTTP ${response.status}); credential retained`)
      await this.runtime.ctx.credentials.deleteRecord(SHISA_CREDENTIAL)
    }
    await this.runtime.ctx.credentials.unset(credentialRef('SHISA_API_KEY'))
    this.registration?.()
    this.registration = undefined
    await this.models?.dispose()
    await Promise.all(this.retiredModels.map(model => model.dispose()))
    this.retiredModels = []
    this.models = undefined
    this.status = { phase: 'signed-out', modelCount: 0 }
  }

  private async restoreAccount(): Promise<void> {
    try {
      const record = await this.runtime.ctx.credentials.readRecord(SHISA_CREDENTIAL)
      if (record?.kind !== 'grant') return
      const grant = grantSchema.parse(record.payload)
      void grant
      this.status = { phase: 'ready', modelCount: 0, catalogPhase: 'idle' }
      this.startCatalog()
    } catch (error) { this.status = { phase: 'error', modelCount: 0, message: error instanceof Error ? error.message : 'Shisa account unavailable' } }
  }

  /** Retry model discovery without reauthorizing the signed-in account. */
  @Remote
  async refreshModels(): Promise<void> {
    await this.initialization
    if (this.status.phase !== 'ready') throw new Error('Sign in before loading models')
    this.startCatalog()
  }

  private startCatalog(): void {
    if (this.catalogTask) return
    this.status = { ...this.status, catalogPhase: 'loading', catalogError: '' }
    this.catalogTask = this.loadCatalog().then(() => {
      this.status = { ...this.status, catalogPhase: 'ready' }
    }, () => {
      this.status = { ...this.status, catalogPhase: 'error', catalogError: 'Model loading failed. Retry without signing in again.' }
    }).finally(() => { this.catalogTask = undefined })
  }

  private async loadCatalog(): Promise<void> {
    const record = await this.runtime.ctx.credentials.readRecord(SHISA_CREDENTIAL)
    if (record?.kind !== 'grant') throw new Error('Sign in to Shisa first')
    const grant = grantSchema.parse(record.payload)
    const endpoints = json.object({ openai_base_url: json.string().url(), model_catalog_url: json.string().url() }).parse(grant.endpoints)
    for (const address of Object.values(endpoints)) {
      const url = new URL(address)
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Unsafe model endpoint')
    }
    const response = await fetch(endpoints.model_catalog_url, { redirect: 'error', headers: { authorization: `Bearer ${grant.api_key.secret}` }, signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.config.requestTimeoutMs)]) })
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Shisa catalog unavailable (HTTP ${response.status})`) }
    const parsed = catalogSchema.safeParse(await readBoundedJson(response, this.config.maxResponseBytes))
    if (!parsed.success) throw new Error('Shisa returned an unsupported model catalog')
    const { models, defaults } = catalogModels(parsed.data)
    if (!models.length) throw new Error('Shisa returned no available models')

    const previous = await this.runtime.ctx.credentials.resolve(credentialRef('SHISA_API_KEY'))
    if (previous?.value !== grant.api_key.secret) await this.runtime.ctx.credentials.set(credentialRef('SHISA_API_KEY'), grant.api_key.secret)
    const generation = await createModelGeneration(this.runtime.ctx, { displayName: 'Shisa', api: 'openai-completions', apiKeyEnv: 'SHISA_API_KEY', baseURL: endpoints.openai_base_url, models }, defaults)
    const previousModel = this.models
    this.registration?.()
    try {
      this.registration = this.runtime.ctx.llm.registerAdapter(['shisa'], generation.adapter)
      this.models = generation
      if (previousModel) this.retiredModels.push(previousModel)
    } catch (error) {
      if (previousModel) this.registration = this.runtime.ctx.llm.registerAdapter(['shisa'], previousModel.adapter)
      await generation.dispose()
      throw error
    }
    this.status = { ...this.status, modelCount: models.length, models: models.map(model => ({ ...model, name: model.name ?? model.id })), baseURL: endpoints.openai_base_url, catalogURL: endpoints.model_catalog_url, catalogUpdatedAt: Date.now() }
  }

}

declare module '@deepseek-ai/cordis' {
  interface Context { shisaProvider: ShisaProvider }
}
