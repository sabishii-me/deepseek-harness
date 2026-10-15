/** Jouzu execution driver using DSH's existing inbox, session events and scope lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import { agentEvents, type AgentOptions, type AgentCancelCause, type CancelOptions, type InboxTarget } from '@deepseek-ai/dsh-agent'
import { JouzuInbox as AgentInbox } from './inbox.ts'
import { JouzuAssistantStream as AssistantStreamAttempt } from './assistant-stream.ts'
import type { ExternalAgent } from './external-factory.ts'
import { JouzuError } from './error.ts'
import { openToolBridge } from './tool-bridge.ts'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createAssistantMessage, createToolResultMessage, ToolCallId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { ToolCallRecovery, appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { Session, SessionId, UserMessage, TurnEndReason } from '@deepseek-ai/dsh-session'
import type JouzuBackend from './index.ts'
import type { JouzuConversation } from './index.ts'
import type {} from './binding.ts'
import { customUserMessage } from './custom-message.ts'
import { answerJouzuDialog } from './dialog.ts'
import { nativeCheckpoint, assertCheckpoint } from './checkpoint.ts'
import { nativeModelGroups, nativeModelSelection, nativeThinkingLevels, selectNativeModel } from './models.ts'
import { selectedSessionModel } from './session-model.ts'
import { jouzuUsage } from './usage.ts'
import { emptyJouzuUi, receiveJouzuUi } from './ui.ts'
import type { JouzuRecord } from './types.ts'

/**
 * DSH host tools the bridge exposes to a confined Jouzu session.
 *
 * A confined process cannot create children at all: the write-restricted token
 * denies CreateProcess, so Jouzu's own shell tool dies with EPERM no matter
 * which shell it resolves (verified for Git Bash, cmd, pwsh and plain node).
 * Exposing these through the bridge inverts ownership instead — Jouzu asks DSH,
 * and DSH runs the command in the sandbox from OUTSIDE the restricted process,
 * which is the only shape that both executes and stays confined.
 *
 * File tools are bridged as well as available natively: the bridged form is what
 * makes their file effects go through the sandbox policy.
 */
export const CONFINED_TOOL_ALLOWLIST = ['read', 'write', 'edit', 'glob', 'grep', 'pwsh'] as const

/**
 * Jouzu tools a confined session must not offer, because their implementation
 * reaches a process spawn the restricted token forbids. Everything else keeps
 * working, so this is a denylist rather than an allowlist.
 *
 * `schedule_prompt` is NOT here: its model-backed jobs run in an in-process
 * AgentSession (`createAgentSession` over `SessionManager.inMemory`), so it
 * needs no child process and stays available.
 */
export const CONFINED_EXCLUDED_TOOLS = ['bg_task', 'subagent'] as const

/** Native wire object validated at the process boundary. */
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Jouzu event object')
  return value as Record<string, unknown>
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid Jouzu event string')
  return value
}
function blocks(value: unknown): ContentBlock[] {
  if (!Array.isArray(value)) throw new Error('Invalid Jouzu message content')
  return value.map((item) => {
    const block = object(item)
    if (block.type === 'text') return { type: 'text' as const, text: string(block.text) }
    if (block.type === 'thinking') return { type: 'reasoning' as const, text: string(block.thinking) }
    if (block.type === 'toolCall') return { type: 'tool-call' as const, id: ToolCallId(string(block.id)), name: string(block.name), arguments: JSON.stringify(block.arguments) }
    throw new Error(`Unsupported Jouzu content block: ${String(block.type)}`)
  })
}

/** One native process belongs to one standard DSH Agent, never a parallel chat controller. */
export class JouzuAgent implements ExternalAgent {
  readonly scope
  private readonly openTools
  readonly ctx: Context
  readonly inbox: AgentInbox
  private readonly dispatch
  private phase: 'idle' | 'maintenance' | 'running' = 'idle'
  private active: Promise<void> = Promise.resolve()
  private disposed = false
  private terminalFailure: Error | undefined
  private conversation: JouzuConversation | undefined
  private turn = 0
  private step = 0
  private stream: AssistantStreamAttempt | undefined
  private revision = 0
  private nativeEventRevision = 0
  private attempt = 0
  private settled: PromiseWithResolvers<void> | undefined
  private cause: AgentCancelCause | undefined
  private fault: Error | undefined
  private maintenance: AbortController | undefined
  private readonly toolRecovery = new ToolCallRecovery()
  private stepOpen = false
  private nativeRunning = false
  private nativeSettled = false
  private readonly dialogLifetime = new AbortController()
  private turnLifetime = new AbortController()
  private ui = emptyJouzuUi()
  private readonly dialogs = new Set<Promise<void>>()

  constructor(ctx: Context, readonly id: SessionId, readonly options: AgentOptions, readonly session: Session, private readonly backend: Pick<JouzuBackend, 'open'>, private readonly uiLimits: { entries: number; text: number } = { entries: 128, text: 262144 }, private readonly toolMaxBytes = 8 * 1024 * 1024) {
    this.openTools = (restricted = false) => openToolBridge(ctx, this, restricted ? [...CONFINED_TOOL_ALLOWLIST] : ctx.tools.schemas(this).map(tool => tool.name), this.toolMaxBytes, restricted)
    this.dispatch = agentEvents(ctx, this)
    this.scope = createScope(ctx, this)
    this.ctx = this.scope.ctx
    this.inbox = new AgentInbox(ctx.sessionProjections, session, this.dispatch)
    this.ctx.on('session/event', (session, event) => {
      if (session === this.session) this.toolRecovery.observe(event)
    })
    this.turn = ctx.sessionProjections.stateOf(session, 'turnBoundary')?.lastTurn ?? 0
    this.ctx.effect(() => async () => { this.dialogLifetime.abort(); await Promise.allSettled(this.dialogs); await this.conversation?.dispose(); if (this.conversation) appendPluginRecord(this.session, 'plugin:jouzu-backend/ui', { ...this.ui, lifecycle: 'closed' }) })
  }
  get status(): 'idle' | 'running' { return this.phase === 'running' ? 'running' : 'idle' }
  followup(message: UserMessage): void { this.send(message, 'next-turn', true) }
  steer(_message: UserMessage): void { throw new Error('Jouzu steering is not integrated; queue an ordinary message instead') }
  inject(_message: UserMessage): void { throw new Error('DSH context injection is not supported by the Jouzu backend') }
  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    if (this.terminalFailure) throw new JouzuError('PROTOCOL', this.terminalFailure.message)
    if (this.disposed) throw new Error('Jouzu Agent is disposed')
    if (target !== 'next-turn' || !wakeup) throw new Error('Jouzu currently accepts ordinary queued turns only')
    if (message.content.some(block => block.type !== 'text')) throw new Error('Jouzu currently accepts text input only')
    if (message.content.some(block => block.type === 'text' && block.text.trimStart().startsWith('/'))) throw new Error('Native Jouzu slash commands and flow/task controls are not yet supported in DSH')
    this.inbox.append(target, message)
    this.wake()
  }
  cancel(cause: AgentCancelCause, options: CancelOptions = {}): void {
    if (!options.keepInbox) this.inbox.clear()
    if (cause.kind === 'disposed') { this.disposed = true; this.dialogLifetime.abort() }
    this.maintenance?.abort(cause)
    this.turnLifetime.abort(cause)
    if (this.phase !== 'running') return
    this.cause ??= cause
    if (this.conversation) void this.conversation.request('abort').catch(error => this.fail(error))
  }
  async whenIdle(): Promise<void> { while (this.phase !== 'idle') await this.active }
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.terminalFailure) throw new JouzuError('PROTOCOL', this.terminalFailure.message)
    if (this.disposed) throw new Error('Jouzu Agent is disposed')
    if (this.phase !== 'idle') throw new Error('Jouzu Agent is busy')
    this.phase = 'maintenance'
    this.maintenance = new AbortController()
    const done = Promise.withResolvers<void>(); this.active = done.promise
    return Promise.resolve().then(() => task(this.maintenance!.signal)).finally(() => {
      this.phase = 'idle'; this.maintenance = undefined; done.resolve(); this.wake()
    })
  }
  private wake(): void {
    if (this.phase !== 'idle' || this.disposed || this.terminalFailure || !this.inbox.hasPending) return
    this.phase = 'running'
    this.dispatch.emit('agent/status', { status: 'running' })
    this.active = Promise.resolve().then(() => this.drain()).catch((error) => {
      this.disposed = true
      this.ctx.logger.error('Jouzu Session failed; further input is disabled: %o', error)
      return this.conversation?.dispose()
    }).finally(() => {
      this.phase = 'idle'
      this.dispatch.emit('agent/status', { status: 'idle' })
      this.wake()
    })
  }
  private async drain(): Promise<void> {
    while (!this.disposed && !this.terminalFailure && this.inbox.hasPending) {
      this.turn++; this.step = 0; this.cause = undefined; this.fault = undefined
      this.turnLifetime = new AbortController()
      this.session.append('turn/start', { turn: this.turn })
      const inputs = this.inbox.claim('next-turn', this.turn)
      let reason: TurnEndReason = { kind: 'completed' }
      try {
        for (const input of inputs) this.session.append('user/message', input, { surfaceOp: 'append' })
        await this.ensureConversation(this.turnLifetime.signal)
        if (this.fault) throw this.fault
        if (this.cause) throw new Error('Jouzu turn cancelled before submission')
        this.nativeSettled = false
        this.settled = Promise.withResolvers<void>()
        const message = inputs.flatMap(input => input.content).map(block => block.type === 'text' ? block.text : '').join('\n')
        appendPluginRecord(this.session, 'plugin:jouzu-backend/delivery', { turn: this.turn, phase: 'submitted' })
        await this.conversation!.request('prompt', { message })
        appendPluginRecord(this.session, 'plugin:jouzu-backend/delivery', { turn: this.turn, phase: 'acknowledged' })
        do { await this.settled.promise } while (this.nativeRunning)
        // Settlement certifies a stable history even when the model failed.
        // Persist that observation before reporting the failed turn.
        if (this.nativeSettled) await this.checkpoint()
        if (this.fault) throw this.fault
      } catch (error) {
        reason = { kind: 'error', error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) } }
      } finally {
        if (this.cause) reason = { kind: 'aborted', reason: this.cause }
        this.stream?.abandon(); this.stream = undefined
        this.closeStep()
        this.session.append('turn/end', { turn: this.turn, reason })
        this.turnLifetime.abort(new Error('Jouzu turn settled'))
        await Promise.allSettled(this.dialogs)
        this.settled = undefined
      }
    }
  }
  private async ensureConversation(signal: AbortSignal): Promise<JouzuConversation> {
    if (this.terminalFailure) throw new JouzuError('PROTOCOL', this.terminalFailure.message)
    if (this.disposed) throw new Error('Jouzu Agent is disposed')
    signal.throwIfAborted()
    if (!this.conversation) {
      const cwd = this.session.header.cwd
      if (!cwd) throw new Error('Jouzu requires a Session workspace')
      const binding = this.ctx.sessionProjections.stateOf(this.session, 'jouzuBinding')
      if (!binding && this.turn > 1) throw new Error('Jouzu native identity is missing; refusing a replacement session')
      const native = await this.backend.open({ session: this.session, cwd, signal, toolBridge: this.openTools, modelSelection: () => selectedSessionModel(this.session, this.options), ...(binding ? { sessionFile: binding.sessionFile } : {}) }, { event: event => this.receive(event), failure: error => this.fail(error) })
      this.conversation = native
      appendPluginRecord(this.session, 'plugin:jouzu-backend/ui', this.ui)
      const state = object(native.state.data)
      const identity = { sessionId: string(state.sessionId), sessionFile: string(state.sessionFile) }
      if (binding && (binding.sessionId !== identity.sessionId || binding.sessionFile !== identity.sessionFile)) {
        await native.dispose(); this.conversation = undefined
        throw new Error('Jouzu resumed a different native session; submission refused')
      }
      if (binding) {
        if (state.isStreaming !== false || state.isCompacting !== false || state.pendingMessageCount !== 0) {
          await native.dispose(); this.conversation = undefined
          throw new Error('Jouzu resumed with active or queued native work; refusing new input until recovery is reconciled')
        }
        try {
          const current = nativeCheckpoint(await native.request('get_entries'))
          assertCheckpoint(this.ctx.sessionProjections.stateOf(this.session, 'jouzuCheckpoint'), current)
        } catch (error) {
          await native.dispose(); this.conversation = undefined
          this.fail(error instanceof Error ? error : new Error(String(error)))
          throw error
        }
      }
      if (!binding) appendPluginRecord(this.session, 'plugin:jouzu-backend/binding', identity)
      await this.ctx.sessions.flush(this.session)
    }
    signal.throwIfAborted()
    return this.conversation
  }

  readonly modelControls = {
    catalog: () => this.runMaintenance(async (signal) => {
      const native = await this.ensureConversation(signal)
      const groups = nativeModelGroups(await native.request('get_available_models'))
      const selected = nativeModelSelection(await native.request('get_state'))
      const levels = selected ? await nativeThinkingLevels(native) : []
      signal.throwIfAborted()
      if (selected) this.session.append('model/selection', selected)
      await this.checkpoint(true)
      return { groups: groups.map(group => ({ ...group, models: group.models.map(model =>
        selected?.provider === group.id && selected.model === model.id
          ? { ...model, reasoning: { efforts: levels.map(id => ({ id, name: id })),
            ...(selected.reasoningEffort === undefined ? {} : { defaultEffort: selected.reasoningEffort }) } }
          : model) })), selected }
    }),
    select: (selection: import('@deepseek-ai/dsh-agent').ModelSelection) => this.runMaintenance(async (signal) => {
      const native = await this.ensureConversation(signal)
      try {
        const selected = await selectNativeModel(native, selection)
        signal.throwIfAborted()
        this.session.append('model/selection', selected)
        await this.checkpoint(true)
        return selected
      } catch (error) {
        // Even rejected thinking changes may follow a committed model change.
        // Unknown mutation outcomes stop admission rather than reporting stale state.
        this.fail(error instanceof Error ? error : new Error(String(error)))
        await native.dispose()
        throw error
      }
    }),
  }

  private flowInspection: Promise<void> | undefined

  inspectFlow(): Promise<void> {
    if (this.terminalFailure) return Promise.reject(new JouzuError('PROTOCOL', this.terminalFailure.message))
    if (this.disposed) return Promise.reject(new Error('Jouzu Agent is disposed'))
    const native = this.conversation
    if (!native) return Promise.reject(new Error('Start a fresh Jouzu Session before reading native Flow status'))
    if (this.flowInspection) return this.flowInspection
    const operation = (async () => {
      const data = object((await native.request('get_commands')).data)
      if (!Array.isArray(data.commands) || !data.commands.some((value) => {
        const command = object(value)
        return command.name === 'flow' && command.source === 'extension'
      })) throw new Error('The native flow extension command is unavailable')
      if (this.disposed || this.terminalFailure) throw new Error('Jouzu stopped during Flow inspection')
      // Pi dispatches extension commands before its streaming prompt path.
      // The official argument-free /flow only reports status; no history mutation
      // or turn-maintenance reservation is needed for this read.
      await native.request('prompt', { message: '/flow' })
    })().finally(() => { if (this.flowInspection === operation) this.flowInspection = undefined })
    this.flowInspection = operation
    return operation
  }

  private async checkpoint(required = false): Promise<void> {
    if (!this.conversation || this.nativeRunning || this.terminalFailure) {
      if (required) throw new Error('Jouzu is unavailable for a stable checkpoint')
      return
    }
    const revision = this.nativeEventRevision
    const checkpoint = nativeCheckpoint(await this.conversation.request('get_entries'))
    // New native activity can race the history request. Never certify a moving history.
    if (this.nativeRunning || this.nativeEventRevision !== revision || this.terminalFailure) {
      if (required) throw new Error('Jouzu history changed during model control checkpoint')
      return
    }
    appendPluginRecord(this.session, 'plugin:jouzu-backend/checkpoint', checkpoint)
    await this.ctx.sessions.flush(this.session)
  }

  private startAutonomousTurn(): void {
    this.phase = 'running'
    this.nativeSettled = false
    this.turn++; this.step = 0; this.cause = undefined; this.fault = undefined
    this.turnLifetime = new AbortController()
    this.settled = Promise.withResolvers<void>()
    this.session.append('turn/start', { turn: this.turn })
    this.dispatch.emit('agent/status', { status: 'running' })
    this.active = Promise.resolve().then(async () => {
      do { await this.settled!.promise } while (this.nativeRunning && !this.terminalFailure)
      this.stream?.abandon(); this.stream = undefined
      this.closeStep()
      const reason: TurnEndReason = this.cause ? { kind: 'aborted', reason: this.cause }
        : this.fault ? { kind: 'error', error: { code: 'UNKNOWN', message: this.fault.message } } : { kind: 'completed' }
      if (this.nativeSettled && !this.terminalFailure) await this.checkpoint()
      this.session.append('turn/end', { turn: this.turn, reason })
      this.turnLifetime.abort(new Error('Jouzu autonomous turn settled'))
      await Promise.allSettled(this.dialogs)
    }).catch(error => this.fail(error instanceof Error ? error : new Error(String(error)))).finally(() => {
      this.settled = undefined
      this.phase = 'idle'
      this.dispatch.emit('agent/status', { status: 'idle' })
      this.wake()
    })
  }

  private fail(error: Error): void {
    if (this.terminalFailure) return
    this.dialogLifetime.abort(error)
    appendPluginRecord(this.session, 'plugin:jouzu-backend/ui', { ...this.ui, lifecycle: 'unavailable' })
    this.terminalFailure = error
    this.fault = error
    this.nativeRunning = false
    this.dispatch.emit('agent/error', { turn: this.turn, step: this.step, error })
    this.ctx.logger.error('Jouzu backend unavailable; pending input is cancelled, not retried: %o', error)
    this.inbox.clear()
    if (this.phase === 'running' && this.settled) this.settled.resolve()
    else if (this.phase === 'idle') {
      // A late protocol failure must not leave the last visible outcome as success.
      const turn = ++this.turn
      this.session.append('turn/start', { turn })
      this.session.append('turn/end', { turn, reason: { kind: 'error', error: { code: 'UNKNOWN', message: error.message } } })
    }
  }
  private closeStep(): void {
    if (this.stepOpen) {
      for (const result of this.toolRecovery.results()) {
        this.session.append('tool/result', result.data, { surfaceOp: 'append' })
      }
      this.session.append('step/end', { turn: this.turn, step: this.step })
    }
    this.stepOpen = false
  }
  private receive(record: JouzuRecord): void {
    this.nativeEventRevision++
    if (this.terminalFailure) return
    if (this.disposed && this.phase !== 'running') return
    const presentation = receiveJouzuUi(this.ui, record, this.uiLimits)
    if (presentation) {
      this.ui = presentation
      appendPluginRecord(this.session, 'plugin:jouzu-backend/ui', presentation)
      if (record.type === 'extension_ui_request') return
    }
    if (record.type === 'agent_settled') {
      this.nativeRunning = false
      this.nativeSettled = true
      this.settled?.resolve()
      return
    }
    if (record.type === 'agent_start' || record.type === 'turn_start') {
      if (this.phase === 'maintenance') throw new Error('Jouzu autonomous work conflicts with Session maintenance')
      if (this.phase === 'idle') this.startAutonomousTurn()
      if (!this.nativeRunning && this.nativeSettled) this.settled = Promise.withResolvers<void>()
      this.nativeSettled = false
      this.nativeRunning = true
      if (record.type === 'agent_start') return
    }
    if (record.type === 'turn_start') {
      this.closeStep(); this.step++; this.stepOpen = true
      this.session.append('step/start', { turn: this.turn, step: this.step }); return
    }
    if (record.type === 'turn_end') { this.closeStep(); return }
    if (record.type === 'message_start' && object(record.message).role === 'assistant') {
      this.stream = new AssistantStreamAttempt(this.id, ++this.attempt, () => ++this.revision, this.turn, this.step, frame => this.dispatch.emit('agent/assistant-stream', { frame }))
      this.stream.start(); return
    }
    if (record.type === 'message_update') {
      const event = object(record.assistantMessageEvent)
      const index = event.contentIndex
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) return
      if (event.type === 'text_start' || event.type === 'thinking_start') this.stream?.push({ type: 'block-start', index, blockType: event.type === 'text_start' ? 'text' : 'reasoning' })
      if (event.type === 'text_delta') this.stream?.push({ type: 'text-delta', index, text: string(event.delta) })
      if (event.type === 'thinking_delta') this.stream?.push({ type: 'reasoning-delta', index, text: string(event.delta) })
      if (event.type === 'text_end') this.stream?.push({ type: 'block-end', index, block: { type: 'text', text: string(event.content) } })
      if (event.type === 'thinking_end') this.stream?.push({ type: 'block-end', index, block: { type: 'reasoning', text: string(event.content) } })
      return
    }
    if (record.type === 'message_end') {
      const message = object(record.message)
      if (message.role === 'custom') {
        this.session.append('user/message', customUserMessage(message), { surfaceOp: 'append' })
        return
      }
      if (message.role !== 'assistant') return
      const stream = this.stream
      if (!stream) throw new Error('Jouzu assistant ended without stream start')
      const content = blocks(message.content)
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        this.fault = new Error(typeof message.errorMessage === 'string' ? message.errorMessage : `Jouzu assistant stopped: ${message.stopReason}`)
      }
      for (const [index, block] of content.entries()) {
        if (block.type !== 'tool-call') continue
        stream.push({ type: 'block-start', index, blockType: 'tool-call' })
        stream.push({ type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments })
        stream.push({ type: 'block-end', index, block })
      }
      const usage = jouzuUsage(message.usage)
      if (usage) stream.push({ type: 'usage', usage })
      stream.settle('assistant/message', () => this.session.append('assistant/message', {
        turn: this.turn, step: this.step, stream: stream.stream,
        ...(usage === undefined ? {} : { usage }),
        message: createAssistantMessage({ content, source: { provider: string(message.provider), model: string(message.model) } }),
      }, { surfaceOp: 'append' }).seq)
      this.stream = undefined; return
    }
    if (record.type === 'tool_execution_start') {
      this.session.append('tool/call', { turn: this.turn, step: this.step, callId: ToolCallId(string(record.toolCallId)), name: string(record.toolName), arguments: JSON.stringify(record.args) }); return
    }
    if (record.type === 'tool_execution_end') {
      this.session.append('tool/result', { turn: this.turn, step: this.step, ...(object(record.result).details === undefined ? {} : { meta: object(record.result).details as import('@deepseek-ai/dsh-util-values').JsonValue }), message: createToolResultMessage({ callId: ToolCallId(string(record.toolCallId)), content: blocks(object(record.result).content), isError: record.isError === true }) }, { surfaceOp: 'append' }); return
    }
    if (record.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(String(record.method))) {
      const work = answerJouzuDialog(this.ctx, this, record, AbortSignal.any([this.dialogLifetime.signal, ...(this.phase === 'running' ? [this.turnLifetime.signal] : this.maintenance ? [this.maintenance.signal] : [])])).then((reply) => {
        if (!this.terminalFailure && !this.disposed) this.conversation?.respond(reply)
      }).catch((error) => {
        this.fail(error instanceof Error ? error : new Error(String(error)))
        return this.conversation?.dispose()
      })
      this.dialogs.add(work)
      void work.finally(() => this.dialogs.delete(work)).catch(error => this.ctx.logger.error(error))
    }
  }
}
