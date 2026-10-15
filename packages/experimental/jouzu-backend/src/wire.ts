/** Bounded LF-only Jouzu RPC transport. Timeout stops the peer: prompt acceptance may be unknown. */
import { randomUUID } from 'node:crypto'
import type { Readable, Writable } from 'node:stream'
import { JouzuError } from './error.ts'
import type { Config, JouzuRecord, JouzuSink } from './types.ts'

interface Pending {
  command: string
  resolve(record: JouzuRecord): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/** Correlates acknowledgements independently of run and extension events. */
export class JouzuWire {
  private buffer = Buffer.alloc(0)
  private readonly pending = new Map<string, Pending>()
  private failure: Error | undefined

  constructor(
    private readonly input: Writable,
    private readonly output: Readable,
    private readonly config: Config,
    private readonly sink: JouzuSink,
  ) {
    output.on('data', this.onData)
    output.on('end', this.onEnd)
    output.on('error', this.onError)
    input.on('error', this.onError)
  }

  /** Submit a command; fulfillment means acknowledged, not that a model turn finished.
   * @param command - Jouzu command type.
   * @param fields - command-specific JSON fields, excluding id and type.
   * @returns the correlated successful response.
   */
  request(command: string, fields: JouzuRecord = {}): Promise<JouzuRecord> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.pending.size >= this.config.maxPendingRequests) {
      return Promise.reject(new JouzuError('LIMIT', 'Too many pending Jouzu commands'))
    }
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new JouzuError('TIMEOUT',
        `Jouzu did not acknowledge ${command}; acceptance is unknown. Reopen and inspect native history before retrying.`)), this.config.requestTimeoutMs)
      this.pending.set(id, { command, resolve, reject, timer })
      try { this.send({ ...fields, type: command, id }) } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  /** Send an extension response, which has no command acknowledgement.
   * @param record - complete extension response.
   */
  send(record: JouzuRecord): void {
    if (this.failure) throw this.failure
    const encoded = JSON.stringify(record) + '\n'
    if (Buffer.byteLength(encoded) > this.config.maxRecordBytes) {
      throw new JouzuError('LIMIT', 'Jouzu command exceeds maxRecordBytes')
    }
    // Bound queued writes rather than accumulating an unbounded promise queue.
    if (this.input.writableLength + Buffer.byteLength(encoded) > this.config.maxRecordBytes) {
      throw new JouzuError('LIMIT', 'Jouzu input is backpressured; command was not written')
    }
    this.input.write(encoded, (error) => { if (error) this.fail(error) })
  }

  /** Close command admission and detach reads; the process owner performs EOF/termination.
   * @param error - rejection shared by all unfinished commands.
   */
  close(error: Error = new JouzuError('CLOSED', 'Jouzu conversation closed')): void {
    if (this.failure) return
    this.failure = error
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.buffer = Buffer.alloc(0)
    this.output.off('data', this.onData)
    this.output.off('end', this.onEnd)
    // Error listeners stay until process disposal; late pipe errors must remain handled.
  }

  /** Detach error listeners only after the process range has exited. */
  detach(): void {
    this.input.off('error', this.onError)
    this.output.off('error', this.onError)
  }

  /** Contain a failed peer or event consumer and stop further admission.
   * @param error - terminal failure owned by the process lifecycle.
   */
  fail(error: Error): void {
    if (this.failure) return
    this.close(error)
    this.sink.failure(error)
  }

  private readonly onError = (error: Error): void => { this.fail(error) }
  private readonly onEnd = (): void => {
    this.fail(new JouzuError('PROTOCOL', this.buffer.length ? 'Jouzu stdout ended inside a record' : 'Jouzu stdout closed unexpectedly'))
  }
  private readonly onData = (chunk: Buffer): void => {
    try {
      let offset = 0
      while (offset < chunk.length) {
        const end = chunk.indexOf(10, offset)
        const part = chunk.subarray(offset, end < 0 ? chunk.length : end)
        if (this.buffer.length + part.length + 1 > this.config.maxRecordBytes) {
          throw new JouzuError('LIMIT', 'Jouzu output exceeds maxRecordBytes')
        }
        this.buffer = Buffer.concat([this.buffer, part])
        if (end < 0) return
        const line = this.buffer.toString('utf8').replace(/\r$/, '')
        this.buffer = Buffer.alloc(0)
        offset = end + 1
        if (line.length) this.receive(line)
        if (this.failure) return
      }
    } catch (error) {
      this.fail(error instanceof JouzuError ? error : new JouzuError('PROTOCOL', 'Invalid Jouzu RPC record', { cause: error }))
    }
  }

  private receive(line: string): void {
    const value: unknown = JSON.parse(line)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new JouzuError('PROTOCOL', 'Expected Jouzu object')
    const record = value as JouzuRecord
    if (typeof record.type !== 'string') throw new JouzuError('PROTOCOL', 'Jouzu record has no type')
    if (record.type !== 'response') {
      try { this.sink.event(record) } catch (cause) {
        throw new JouzuError('CONSUMER', 'Jouzu event consumer failed; conversation stopped', { cause })
      }
      return
    }
    if (typeof record.id !== 'string' || typeof record.success !== 'boolean') throw new JouzuError('PROTOCOL', 'Invalid Jouzu response')
    const pending = this.pending.get(record.id)
    if (!pending || record.command !== pending.command) throw new JouzuError('PROTOCOL', 'Unmatched Jouzu response')
    this.pending.delete(record.id)
    clearTimeout(pending.timer)
    if (record.success) pending.resolve(record)
    else pending.reject(new JouzuError('REMOTE', typeof record.error === 'string' ? record.error : 'Jouzu rejected the command'))
  }
}
