/** External-driver Inbox over the official durable inbox projection. */
import type { AgentEventDispatch, Inbox, InboxTarget } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import type SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'

/** Jouzu owns admission while DSH's standard events preserve queued input. */
export class JouzuInbox implements Inbox {
  constructor(private readonly projections: SessionProjectionRegistry, private readonly session: Session,
    private readonly dispatch: AgentEventDispatch) {}
  private queue(target: InboxTarget): readonly UserMessage[] {
    const state = this.projections.stateOf(this.session, 'inbox')
    if (!state) throw new Error('Standard inbox projection is required for Jouzu')
    return state[target]
  }
  get nextTurn() { return this.queue('next-turn') }
  get nextStep() { return this.queue('next-step') }
  get hasPending() { return this.nextTurn.length + this.nextStep.length > 0 }
  clear(): void { this.splice('next-step', 0, this.nextStep.length, []); this.splice('next-turn', 0, this.nextTurn.length, []) }
  append(target: InboxTarget, message: UserMessage): void { this.splice(target, this.queue(target).length, 0, [message]) }
  prepend(target: InboxTarget, message: UserMessage): void { this.splice(target, 0, 0, [message]) }
  replace(id: MessageId, message: UserMessage): boolean { return this.edit(id, [message]) }
  remove(id: MessageId): boolean { return this.edit(id, []) }
  private edit(id: MessageId, inserted: UserMessage[]): boolean {
    for (const target of ['next-step', 'next-turn'] as const) {
      const index = this.queue(target).findIndex(item => item.id === id)
      if (index >= 0) { this.splice(target, index, 1, inserted); return true }
    }
    return false
  }
  splice(target: InboxTarget, start: number, deleteCount: number, inserted: UserMessage[]): UserMessage[] {
    return this.commit(target, start, deleteCount, inserted, true)
  }
  /** Claim the next queued prompt and staged step context.
   * @param target - whether to admit a fresh queued turn.
   * @param turn - DSH turn receiving these inputs.
   * @returns claimed messages in execution order.
   */
  claim(target: InboxTarget, turn: number): UserMessage[] {
    const messages = this.commit('next-step', 0, this.nextStep.length, [], false)
    if (target === 'next-turn') messages.push(...this.commit('next-turn', 0, 1, [], false))
    for (const message of messages) this.dispatch.emit('agent/inbox/claimed', { message, turn })
    return messages
  }
  private commit(target: InboxTarget, start: number, count: number, inserted: UserMessage[], discard: boolean): UserMessage[] {
    const before = [...this.queue(target)]
    const after = [...before]
    const removed = after.splice(start, count, ...inserted)
    const position = Number.isNaN(start) ? 0 : start < 0 ? Math.max(before.length + Math.trunc(start), 0) : Math.min(Math.trunc(start), before.length)
    if (!removed.length && !inserted.length) return []
    const other = this.queue(target === 'next-turn' ? 'next-step' : 'next-turn')
    const ids = [...after, ...other].map(message => message.id)
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate pending Jouzu input identity')
    const event = this.session.append('agent/inbox/spliced', {
      target, start: position, removedCount: removed.length, inserted,
      ...(discard && removed.length ? { outcome: 'canceled' as const } : {}),
    })
    if (discard) for (const message of removed) this.dispatch.emit('agent/inbox/discarded', { message })
    for (const message of event.data.inserted) this.dispatch.emit('agent/inbox/inserted', { message })
    return removed
  }
}
