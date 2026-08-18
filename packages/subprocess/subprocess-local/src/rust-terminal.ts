/** Desktop Rust terminal transport; policy and readiness remain in terminal-bash. */

import { Buffer } from 'node:buffer'
import { connect, type Socket } from 'node:net'
import { PassThrough } from 'node:stream'
import type {
  SubprocessOutcome,
  SubprocessTerminalForeground,
  SubprocessTerminalHandle,
  SubprocessTerminalSignal,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { childEnv } from './spawn.ts'

interface WireEvent {
  event: 'ready' | 'data' | 'exit' | 'ack' | 'error'
  id?: number
  pid?: number | null
  data?: string
  exit_code?: number | null
  message?: string
}

interface PendingSpawn {
  resolve(handle: SubprocessTerminalHandle): void
  reject(error: unknown): void
  spec: SubprocessTerminalSpawnSpec
}

/**
 * One authenticated connection to the desktop Rust terminal service. The
 * client multiplexes terminal ids over newline-delimited control records and
 * exposes each session through the existing subprocess terminal contract.
 */
export class RustTerminalClient {
  private socket: Socket | undefined
  private connecting: Promise<void> | undefined
  private input = ''
  private nextId = 1
  private readonly spawns = new Map<number, PendingSpawn>()
  private readonly handles = new Map<number, RustTerminalHandle>()

  constructor(private readonly address: string, private readonly token: string) {}

  /**
   * Allocate one Rust-owned terminal from a fully resolved subprocess spec.
   * @param spec - executable, environment, directory, dimensions, and cancellation.
   * @returns The published terminal handle after Rust reports allocation ready.
   */
  async spawn(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    spec.signal?.throwIfAborted()
    await this.ensureConnected()
    const id = this.nextId++
    return new Promise<SubprocessTerminalHandle>((resolve, reject) => {
      this.spawns.set(id, { resolve, reject, spec })
      this.send({
        op: 'spawn', id, argv: spec.argv, cwd: spec.cwd, env: childEnv(spec.env),
        rows: spec.rows, cols: spec.cols,
      })
    })
  }

  /**
   * Send one operation for an already-published terminal handle.
   * @param message - protocol operation carrying its terminal id.
   */
  request(message: object): void { this.send(message) }

  private async ensureConnected(): Promise<void> {
    if (this.socket !== undefined && !this.socket.destroyed) return
    if (this.connecting !== undefined) return this.connecting
    this.connecting = new Promise<void>((resolve, reject) => {
      const [host, portText] = this.address.split(':')
      const port = Number(portText)
      const socket = connect({ host, port }, () => {
        this.socket = socket
        socket.write(`${this.token}\n`)
        resolve()
      })
      socket.setEncoding('utf8')
      socket.on('data', chunk => this.onData(String(chunk)))
      socket.once('error', reject)
      socket.on('error', error => this.fail(error))
      socket.on('close', () => this.fail(new Error('Rust terminal service disconnected')))
    }).finally(() => { this.connecting = undefined })
    return this.connecting
  }

  private send(message: object): void {
    const socket = this.socket
    if (socket === undefined || socket.destroyed) throw new Error('Rust terminal service is not connected')
    socket.write(`${JSON.stringify(message)}\n`)
  }

  private onData(chunk: string): void {
    this.input += chunk
    while (true) {
      const newline = this.input.indexOf('\n')
      if (newline < 0) return
      const line = this.input.slice(0, newline)
      this.input = this.input.slice(newline + 1)
      if (line.length > 0) this.onEvent(JSON.parse(line) as WireEvent)
    }
  }

  private onEvent(event: WireEvent): void {
    const id = event.id
    if (event.event === 'ready' && id !== undefined) {
      const pending = this.spawns.get(id)
      if (pending === undefined) return
      this.spawns.delete(id)
      const handle = new RustTerminalHandle(this, id, event.pid ?? id)
      this.handles.set(id, handle)
      pending.resolve(handle)
      return
    }
    if (event.event === 'error') {
      const error = new Error(`Rust terminal service: ${event.message ?? 'unknown error'}`)
      if (id !== undefined) {
        const pending = this.spawns.get(id)
        if (pending !== undefined) {
          this.spawns.delete(id)
          pending.reject(error)
          return
        }
        this.handles.get(id)?.fail(error)
      }
      return
    }
    if (id === undefined) return
    const handle = this.handles.get(id)
    if (handle === undefined) return
    if (event.event === 'data' && event.data !== undefined) handle.push(Buffer.from(event.data, 'base64'))
    if (event.event === 'exit') {
      this.handles.delete(id)
      handle.exit(event.exit_code ?? null)
    }
  }

  private fail(error: Error): void {
    this.socket = undefined
    for (const pending of this.spawns.values()) pending.reject(error)
    this.spawns.clear()
    for (const handle of this.handles.values()) handle.fail(error)
    this.handles.clear()
  }
}

class RustTerminalHandle implements SubprocessTerminalHandle {
  readonly output = new PassThrough()
  readonly done: Promise<SubprocessOutcome>
  private readonly outcome = Promise.withResolvers<SubprocessOutcome>()
  private terminated: Promise<void> | undefined

  constructor(
    private readonly client: RustTerminalClient,
    private readonly id: number,
    readonly pid: number,
  ) { this.done = this.outcome.promise }

  async write(data: string): Promise<void> {
    this.client.request({ op: 'write', id: this.id, data: Buffer.from(data).toString('base64') })
  }

  async inspectForeground(): Promise<SubprocessTerminalForeground> {
    return { processGroupId: this.pid, inputWaiting: false }
  }

  async signalForeground(signal: SubprocessTerminalSignal): Promise<number> {
    this.client.request({ op: 'signal', id: this.id, signal })
    return this.pid
  }

  terminate(): Promise<void> {
    this.terminated ??= this.terminateOnce()
    return this.terminated
  }

  push(data: Buffer): void { this.output.write(data) }

  exit(exitCode: number | null): void {
    this.output.end()
    this.outcome.resolve({ exitCode, signal: null })
  }

  fail(error: Error): void {
    this.output.destroy(error)
    this.outcome.reject(error)
  }

  private async terminateOnce(): Promise<void> {
    this.client.request({ op: 'terminate', id: this.id })
    await this.done.catch(() => {})
  }
}
