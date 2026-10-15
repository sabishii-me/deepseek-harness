/** Optional Jouzu execution with plugin-owned routing over official Agent factories. */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-subprocess'
import { isAbsolute, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { mkdir, readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { openModelBridge } from './model-bridge.ts'
import { bridgeExtension } from './pi-extension.ts'
import { toolBridgeExtension } from './tool-extension.ts'
import { restrictedToolExtension } from './restricted-extension.ts'
import { CONFINED_EXCLUDED_TOOLS, CONFINED_TOOL_ALLOWLIST } from './agent.ts'
import { executionPolicy, confineJouzu } from './execution.ts'
import { mountNativeFactory, routeFactories } from './factory-router.ts'
import { externalAgentFactory } from './external-factory.ts'
import { JouzuAgent } from './agent.ts'
import { checkpointProjection } from './checkpoint.ts'
import { deliveryProjection } from './delivery.ts'
import { activityProjection } from './activity.ts'
import { jouzuUiProjection } from './ui.ts'
import { bindingProjection } from './binding.ts'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import { JouzuWire } from './wire.ts'
import { JouzuError } from './error.ts'
import type { Config, JouzuRecord, JouzuSink, OpenOptions } from './types.ts'
export type * from './types.ts'
export { JouzuError } from './error.ts'

/** Caller-owned conversation; keep alive across agent_settled for background work. */
export interface JouzuConversation {
  /** Acknowledged native state at startup, including session identity. */
  readonly state: JouzuRecord
  /** Send a native command. Success is acknowledgement, not run completion. */
  request(command: string, fields?: JouzuRecord): Promise<JouzuRecord>
  /** Reply to an extension dialog with its original id. No auto-approval is performed. */
  respond(record: JouzuRecord): void
  /** Close stdin, escalate if needed, and wait for the managed process range to exit. */
  dispose(): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional native Jouzu conversation service. */
    jouzuBackend: JouzuBackend
  }
}

/** Plugin-owned process lifecycle; consumers own native events and presentation. */
export default class JouzuBackend extends Service {
  static inject = ['subprocess']
  static Config = z.object({
    restrictedToolTest: z.boolean().default(false),
    uiEntryLimit: z.natural().min(1).default(128),
    uiTextLimit: z.natural().min(1).default(262144),
    argv: z.array(z.string()).required(),
    credentialEnv: z.dict(z.string()).default({}),
    env: z.dict(z.string()).default({}),
    maxRecordBytes: z.natural().min(1).default(8 * 1024 * 1024),
    maxPendingRequests: z.natural().min(1).default(32),
    modelTimeoutMs: z.natural().min(1).max(2_147_483_647).default(300000),
    requestTimeoutMs: z.natural().min(1).max(2_147_483_647).default(30_000),
    eofGraceMs: z.natural().min(1).max(2_147_483_647).default(6_000),
    terminateGraceMs: z.natural().min(1).max(2_147_483_647).default(3_000),
  })
  private readonly runtime: { ctx: Context }
  private closed = false
  private readonly startupLifetime = new AbortController()
  private readonly startups = new Set<Promise<unknown>>()
  private readonly disposers = new Set<() => Promise<void>>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'jouzuBackend')
    this.runtime = { ctx }
    ctx.inject(['agents', 'sessions', 'sessionProjections', 'llm', 'tools', 'systemPrompt'], async (driverCtx) => {
      driverCtx.sessionProjections.register(deliveryProjection)
      driverCtx.sessionProjections.register(activityProjection)
      driverCtx.sessionProjections.register(jouzuUiProjection)
      driverCtx.sessionProjections.register(bindingProjection)
      driverCtx.sessionProjections.register(checkpointProjection)
      const native = await mountNativeFactory(driverCtx)
      const external = externalAgentFactory(driverCtx, (context, id, options, session) =>
        new JouzuAgent(context, id, options, session, this, { entries: config.uiEntryLimit ?? 128, text: config.uiTextLimit ?? 262144 }, config.maxRecordBytes))
      driverCtx.agents.setFactory(routeFactories(native, external, 'jouzu', async (options) => {
        const persistence = driverCtx.get('sessionPersistence')
        if (!persistence) throw new Error('Jouzu routing requires Session persistence for resume')
        const snapshot = await persistence.stat(options.resumeSessionId, options.signal ? { signal: options.signal } : {})
        if (!snapshot) throw new Error('Cannot route a missing stored Session')
        return snapshot.header.agentPreset
      }))
    })
    if (!config.argv.length || config.argv.some(arg => !arg.length)) throw new Error('jouzu-backend: argv must contain an executable and nonempty arguments')
    ctx.effect(() => async () => {
      this.closed = true
      this.startupLifetime.abort(new Error('Jouzu backend unloaded during startup'))
      await Promise.allSettled(this.startups)
      const outcomes = await Promise.allSettled([...this.disposers].map(dispose => dispose()))
      const errors = outcomes.filter(result => result.status === 'rejected').map(result => result.reason)
      if (errors.length) throw new AggregateError(errors, 'Jouzu process cleanup failed')
    })
  }

  /** Start or reopen a native Jouzu conversation, rolling back failed startup.
   * @param options - absolute workspace and optional absolute native session file.
   * @param sink - synchronous event/failure consumer installed before startup.
   * @returns caller-owned conversation after get_state acknowledgement.
   */
  open(options: OpenOptions, sink: JouzuSink): Promise<JouzuConversation> {
    const opening = this.openOwned(options, sink)
    this.startups.add(opening)
    void opening.then(() => this.startups.delete(opening), () => this.startups.delete(opening))
    return opening
  }

  private async openOwned(options: OpenOptions, sink: JouzuSink): Promise<JouzuConversation> {
    if (this.closed) throw new JouzuError('CLOSED', 'Jouzu backend is disposed')
    const startupSignal = options.signal === undefined ? this.startupLifetime.signal : AbortSignal.any([this.startupLifetime.signal, options.signal])
    startupSignal.throwIfAborted()
    if (!isAbsolute(options.cwd) || (options.sessionFile !== undefined && !isAbsolute(options.sessionFile))) {
      throw new Error('jouzu-backend: workspace and native session file must be absolute')
    }
    if (options.session.header.cwd !== options.cwd) throw new JouzuError('POLICY', 'Jouzu cwd must match its owning Session workspace')
    let bridge: Awaited<ReturnType<typeof openModelBridge>> | undefined
    let tools: Awaited<ReturnType<NonNullable<OpenOptions['toolBridge']>>> | undefined
    let directory: string | undefined
    let child: ReturnType<Context['subprocess']['spawn']>
    let execution: Awaited<ReturnType<typeof confineJouzu>>
    const credentialEnv = this.config.credentialEnv ?? {}
    // Child diagnostics retained for the failure report; an unexpected exit is otherwise bare.
    const diagnostics: string[] = []
    try {
      const policy = executionPolicy(this.ctx, options.session)
      // A confined process cannot create children (the write-restricted token
      // denies CreateProcess), so a Jouzu session under any confining policy must
      // reach the host through the tool bridge. This is the normal path for
      // Workspace Write, not a test mode: without the bridge, every shell command
      // fails with EPERM no matter which shell it resolves to.
      const bridged = policy.mode !== 'danger-full-access'
      if (bridged && !options.toolBridge) throw new Error('A confined Jouzu session requires the DSH tool bridge')
      // A confined session keeps every Jouzu tool that needs no child process.
      // Only the three that reach a spawn are excluded, because the
      // write-restricted token denies CreateProcess outright: bg_task spawns a
      // detached child, subagent forks a worker, and recurring schedule_prompt
      // fires prompts on a timer. See RESTRICTED-CAPABILITY-BOUNDARY.md.
      const extra: string[] = bridged ? ['--exclude-tools', CONFINED_EXCLUDED_TOOLS.join(',')] : []
      const env = { ...this.config.env }
      // JOUZU_HOME must be writable under the ACTIVE policy. A confining policy
      // (read-only / workspace-write) only permits writes inside the workspace,
      // so Jouzu's default user-level state directory (AppData) is denied and its
      // Flow lock cannot be acquired. Redirect it inside the workspace whenever
      // the session is confined; a Full-access session keeps the user's own home
      // and therefore its normal identity and history.
      if (policy.mode !== 'danger-full-access') {
        env.JOUZU_HOME = join(options.cwd, '.jouzu-dsh-state')
        // Jouzu/Pi resolve their agent directory from HOME (or
        // PI_CODING_AGENT_DIR) — NOT from JOUZU_HOME. Under confinement the
        // default (~/.pi) is outside the workspace and therefore unwritable, so
        // both the settings that select the shell and every session artifact
        // written there would fail. Pin it inside the workspace as well.
        env.PI_CODING_AGENT_DIR = join(env.JOUZU_HOME, 'agent')
        await ensureConfinedShell(env.PI_CODING_AGENT_DIR)
      }
      if (options.modelSelection) {
        const selected = options.modelSelection()
        const info = await this.ctx.get('llm')!.resolveModelInfo(selected.provider, selected.model, startupSignal)
        if (!info.context?.contextWindow || !(selected.maxTokens ?? info.defaultMaxTokens)) throw new Error('Selected model must expose context and output limits before Jouzu can start')
        env.DSH_BRIDGE_MODEL = JSON.stringify({ contextWindow: info.context.contextWindow, maxTokens: selected.maxTokens ?? info.defaultMaxTokens })
        bridge = await openModelBridge(this.runtime.ctx, options.modelSelection, { maxBytes: this.config.maxRecordBytes, timeoutMs: this.config.modelTimeoutMs ?? 300000 })
        directory = await mkdtemp(join(tmpdir(), 'dsh-jouzu-extension-'))
        const extension = join(directory, 'provider.mjs')
        await writeFile(extension, bridgeExtension, { mode: 0o600 })
        extra.push('--extension', extension, '--provider', 'dsh-bridge', '--model', 'selected')
        env.DSH_BRIDGE_URL = bridge.url
        env.DSH_BRIDGE_TOKEN = bridge.token
      }
      if (options.toolBridge) {
        tools = await options.toolBridge(bridged)
        directory ??= await mkdtemp(join(tmpdir(), 'dsh-jouzu-extension-'))
        const extension = join(directory, 'tools.mjs')
        await writeFile(extension, bridged ? restrictedToolExtension(CONFINED_TOOL_ALLOWLIST) : toolBridgeExtension, { mode: 0o600 })
        extra.push('--extension', extension)
        env.DSH_TOOL_BRIDGE_URL = tools.url
        env.DSH_TOOL_BRIDGE_TOKEN = tools.token
      }
      const argv = [...this.config.argv, 'pi', '--mode', 'rpc', ...extra, ...(options.sessionFile === undefined ? [] : ['--session', options.sessionFile])]
      // Restricted test sessions keep their narrowed tool allowlist but run under
      // the same DSH sandbox as every other policy: restriction narrows Jouzu's
      // tools, it never bypasses the seam. A workspace-write call whose ACL grant
      // fails therefore fails closed here too, with no unconfined fallback.
      execution = await confineJouzu(this.ctx, options.session, argv, startupSignal)
      if (execution.enforcement !== 'full') this.ctx.logger.warn('Jouzu session %s: policy=%s, enforcement=%s', options.session.id, execution.mode, execution.enforcement)
      for (const [name, reference] of Object.entries(credentialEnv)) {
        if (Object.hasOwn(env, name)) throw new Error('Jouzu credential environment conflicts with explicit env')
        const credential = await this.ctx.get('credentials')?.resolve(credentialRef(reference))
        if (!credential) throw new Error(`Missing Jouzu credential reference: ${reference}`)
        env[name] = credential.value
      }
      startupSignal.throwIfAborted()
      child = this.ctx.subprocess.spawn({ argv: execution.argv, cwd: options.cwd, env,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }, graceMs: this.config.terminateGraceMs })
      // Keep the child's own diagnostics: an unexpected exit is otherwise reported as a bare
      // protocol error with no cause, which is indistinguishable from a bridge or routing fault.
      child.stderr?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split(/\r?\n/u)) {
          const text = line.trim()
          if (!text) continue
          diagnostics.push(text)
          if (diagnostics.length > 40) diagnostics.shift()
          // Mirror to the host log AND a side file: a startup that never answers
          // `get_state` otherwise surfaces as a bare wire timeout with no child
          // evidence, and debug-level log records may be filtered out entirely.
          this.ctx.logger.warn('Jouzu child stderr: %s', text)
          try { appendFileSync(join(tmpdir(), 'dsh-jouzu-child.log'), `${new Date().toISOString()} ${text}\n`) } catch { /* diagnostics only */ }
        }
      })
    } catch (error) {
      await tools?.dispose()
      await bridge?.dispose()
      if (directory) await rm(directory, { recursive: true, force: true })
      throw error
    }
    let stopStartupObservation: (() => void) | undefined
    let stopCredentialObservation: (() => void) | undefined
    let stopPolicyObservation: (() => void) | undefined
    let wire: JouzuWire | undefined
    let disposal: Promise<void> | undefined
    const dispose = (): Promise<void> => {
      disposal ??= (async () => {
        stopStartupObservation?.()
        stopPolicyObservation?.()
        stopCredentialObservation?.()
        wire?.close()
        child.stdin?.end()
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), this.config.eofGraceMs)
        try {
          if (!await child.waitForExit(controller.signal)) {
            child.terminate()
            await child.waitForExit()
          }
        } catch (cause) {
          child.terminate()
          await child.waitForExit()
          throw cause
        } finally {
          clearTimeout(timer)
          wire?.detach()
          await tools?.dispose()
          await bridge?.dispose()
          if (directory) await rm(directory, { recursive: true, force: true })
          this.disposers.delete(dispose)
        }
      })()
      return disposal
    }
    this.disposers.add(dispose)
    const reportFailure = (error: Error): void => {
      child.terminate()
      try { sink.failure(error) } catch (cause) { this.ctx.logger.error('Jouzu failure consumer threw: %o', cause) }
      void dispose().catch(cause => this.ctx.logger.error('Jouzu cleanup failed: %o', cause))
    }
    const tail = (): string => diagnostics.length === 0 ? '' : `; last stderr: ${diagnostics.slice(-6).join(' | ')}`
    void child.done.then(
      () => wire?.fail(new JouzuError('CLOSED', `Jouzu process exited; inspect native history before retrying${tail()}`)),
      cause => wire ? wire.fail(new JouzuError('CLOSED', `Jouzu process failed${tail()}`, { cause })) : reportFailure(new JouzuError('CLOSED', `Jouzu startup failed${tail()}`, { cause })),
    )
    child.stderr?.on('end', () => {
      if (!this.closed && diagnostics.length > 0) this.ctx.logger.warn('Jouzu stderr closed: %s', diagnostics.slice(-6).join(' | '))
    })
    try {
      if (!child.stdin || !child.stdout) throw new JouzuError('CLOSED', 'Jouzu subprocess pipes unavailable')
      wire = new JouzuWire(child.stdin, child.stdout, this.config, { event: (record) => { execution.assertPolicy(); sink.event(record) }, failure: reportFailure })
      const connection = wire
      stopCredentialObservation = this.ctx.on('credentials/reference-updated', (ref) => {
        if (Object.values(credentialEnv).includes(ref)) connection.fail(new JouzuError('CLOSED', 'Jouzu credential changed; native process closed to prevent use of stale credentials'))
      })
      const abortStartup = (): void => connection.fail(new JouzuError('CLOSED', 'Jouzu startup cancelled before publication', { cause: startupSignal.reason }))
      startupSignal.addEventListener('abort', abortStartup, { once: true })
      stopStartupObservation = () => startupSignal.removeEventListener('abort', abortStartup)
      if (startupSignal.aborted) abortStartup()
      stopPolicyObservation = this.ctx.on('session/event', (session, event) => {
        if (session !== options.session || event.type !== 'sandbox/mode') return
        try { execution.assertPolicy() } catch (error) {
          connection.fail(error instanceof Error ? error : new Error(String(error)))
        }
      })
      // Recheck after installing observation so a policy changed during startup cannot escape.
      execution.assertPolicy()
      const state = await connection.request('get_state')
      startupSignal.throwIfAborted()
      stopStartupObservation()
      stopStartupObservation = undefined
      return {
        state,
        request: (command, fields) => {
          try { execution.assertPolicy() } catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error))
            connection.fail(failure)
            return Promise.reject(failure)
          }
          return connection.request(command, fields)
        },
        respond: (record) => {
          if (record.type !== 'extension_ui_response' || typeof record.id !== 'string') throw new JouzuError('PROTOCOL', 'Expected extension UI response with original request id')
          try { execution.assertPolicy() } catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error))
            connection.fail(failure)
            throw failure
          }
          connection.send(record)
        },
        dispose,
      }
    } catch (error) {
      await dispose()
      throw error
    }
  }
}

/**
 * Pin the confined session's shell to native PowerShell.
 *
 * The `bash` tool resolves Git Bash first, and MSYS2 cannot start under the
 * restricted token: it dies creating `\BaseNamedObjects\msys-2.0*`, which the
 * write-restricted token forbids. The failure surfaces as `spawn EPERM` on
 * every command, so the tool looks broken rather than restricted. A native
 * Windows shell has no such shared-object dependency and runs confined.
 *
 * This is a user-level Jouzu/Pi setting (settings.json in the session's agent
 * directory) — no official package and no Jouzu source is modified. It affects
 * ONLY the confined session's agent directory; an unconfined session keeps its
 * own home, and therefore its Git Bash.
 * @param agentDir - the confined session's agent directory (PI_CODING_AGENT_DIR).
 */
async function ensureConfinedShell(agentDir: string): Promise<void> {
  const settingsFile = join(agentDir, 'settings.json')
  await mkdir(agentDir, { recursive: true })
  let settings: Record<string, unknown> = {}
  try {
    const existing = JSON.parse(await readFile(settingsFile, 'utf8')) as unknown
    // A non-object settings file is not ours to reinterpret; leave it alone.
    if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) settings = existing as Record<string, unknown>
  } catch { /* absent or unreadable: start from an empty document */ }
  const shell = confinedShellPath()
  if (settings.shellPath === shell) return
  settings.shellPath = shell
  await writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
}

/** The native shell a confined session uses: PowerShell 7 when installed, Windows PowerShell otherwise.
 * @returns absolute path of the shell currently present on PATH.
 */
function confinedShellPath(): string {
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    const found = spawnSync('where', [candidate], { encoding: 'utf8', windowsHide: true })
    const first = found.status === 0 ? found.stdout.split(/\r?\n/u)[0]?.trim() : ''
    if (first) return first
  }
  throw new JouzuError('POLICY', 'No PowerShell found on PATH; a confined Jouzu session cannot run the Git Bash shell')
}
