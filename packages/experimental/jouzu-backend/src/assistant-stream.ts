/** Jouzu stream publication using only the public DSH stream accumulator. */
import { AssistantStreamAccumulator, LlmAttemptId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'

/** Translate one native assistant into durable and live DSH stream records. */
export class JouzuAssistantStream {
  private readonly record = new AssistantStreamAccumulator()
  private count = 0
  private closed = false
  private readonly id: LlmAttemptId
  constructor(session: SessionId, attempt: number, private readonly revision: () => number,
    private readonly turn: number, private readonly step: number,
    private readonly publish: (frame: AssistantStreamFrame) => void) {
    this.id = LlmAttemptId(`${session}:jouzu:${attempt}`)
  }
  /** Durable stream captured so far. */
  get stream() { return [...this.record.snapshot()] }
  /** Publish the native assistant opening event. */
  start(): void {
    this.publish({ type: 'start', attemptId: this.id, revision: this.revision(), turn: this.turn, step: this.step })
  }
  /** Store and publish one translated native chunk.
   * @param chunk - provider-neutral DSH chunk.
   */
  push(chunk: StreamChunk): void {
    if (this.closed) throw new Error('Jouzu assistant stream already closed')
    const item = this.record.push({ time: Date.now(), chunk })
    this.publish({ type: 'chunk', attemptId: this.id, revision: this.revision(), index: this.count++, time: item.time, chunk: item.chunk })
  }
  /** Commit durable content before exposing settlement.
   * @param eventType - event receiving the accumulated stream.
   * @param append - synchronous Session append.
   */
  settle(eventType: 'assistant/message' | 'assistant/attempt', append: () => SessionSeq): void {
    if (this.closed) throw new Error('Jouzu assistant stream already closed')
    let seq: SessionSeq
    try { seq = append() } catch (error) { this.abandon(); throw error }
    this.closed = true
    this.publish({ type: 'end', attemptId: this.id, revision: this.revision(), index: this.count, outcome: { kind: 'committed', eventType, seq } })
  }
  /** End transient output without inventing a durable assistant message. */
  abandon(): void {
    if (this.closed) return
    this.closed = true
    this.publish({ type: 'end', attemptId: this.id, revision: this.revision(), index: this.count, outcome: { kind: 'abandoned' } })
  }
}
