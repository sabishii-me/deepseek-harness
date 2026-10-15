/** Incremental observations from native tool receipts; never a scheduler or task-file writer. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const taskSchema = z.object({ id: z.string(), title: z.string(), status: z.string(), waiting: z.boolean(), paused: z.boolean().optional() })
const jobSchema = z.object({ execution: z.string().nullable(), id: z.string(), title: z.string(), status: z.string(), startedAt: z.number().nullable(), updatedAt: z.number().nullable(), exitCode: z.number().nullable(), work: z.string().nullable() })
const waitSchema = z.object({ id: z.string(), reason: z.string(), status: z.string(), handles: z.array(z.string()) })
const callSchema = z.object({ id: z.string(), name: z.string(), args: z.string() })
const schema = z.object({ tasks: z.array(taskSchema), jobs: z.array(jobSchema), waits: z.array(waitSchema), calls: z.array(callSchema) })
/** Tool-derived Session state; missing receipts never imply completion. */
export type JouzuActivity = z.infer<typeof schema>
import type {} from './ui-types.ts'
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
/** Fold committed tool calls and successful native receipts.
 * @param state - previous task/job observations.
 * @param event - committed Session event.
 * @returns incrementally updated observations, not inferred live process state.
 */
export function foldActivity(state: JouzuActivity, event: SessionEvent): JouzuActivity {
  const record = pluginRecordOf(event)
  if (record?.type === 'plugin:jouzu-backend/ui') {
    const flow = object(record.data).flow
    if (typeof flow !== 'string') return state
    let envelope: Record<string, unknown>
    try { envelope = object(JSON.parse(flow)) } catch (error) { void error; return state }
    const content = object(envelope.content)
    if (envelope.kind === 'result' && Array.isArray(content.sample)) {
      const results = content.sample.map(object)
      return { ...state, jobs: state.jobs.map((job) => {
        const result = results.find(item => item.execution === job.execution)
        if (!result) return job
        const status = result.status === 'success' ? 'completed' : result.status === 'failure' ? 'failed' : result.status === 'cancelled' ? 'cancelled' : undefined
        return status ? { ...job, status, title: typeof result.title === 'string' ? result.title : job.title } : job
      }) }
    }
    const wait = object(content.wait)
    if (envelope.kind === 'wait' && typeof wait.token === 'string' && typeof wait.state === 'string') {
      return { ...state, waits: state.waits.map(item => item.id === wait.token ? { ...item, status: String(wait.state) } : item) }
    }
    return state
  }
  if (event.type === 'tool/call' && ['TaskCreateMany', 'TaskCreate', 'TaskUpdate', 'TaskList', 'bg_task', 'bg_status', 'agent_wait'].includes(event.data.name)) {
    return { ...state, calls: [...state.calls, { id: event.data.callId, name: event.data.name, args: event.data.arguments }] }
  }
  if (event.type !== 'tool/result') return state
  const call = state.calls.find(call => call.id === event.data.message.source.callId)
  if (!call) return state
  const next = { ...state, calls: state.calls.filter(item => item !== call) }
  if (event.data.message.isError) return next
  let args: Record<string, unknown>
  try { args = object(JSON.parse(call.args)) } catch (error) { void error; return next }
  const text = event.data.message.content.map(part => part.type === 'text' ? part.text : '').join('\n')
  if (call.name === 'TaskList') {
    if (text.trim() === 'No tasks found') return { ...next, tasks: [] }
    const listed = [...text.matchAll(/^#(\d+) \[(pending|in_progress|completed)\] (.+)$/gm)]
    if (!listed.length) return next
    return { ...next, tasks: listed.map((match) => {
      const previous = next.tasks.find(task => task.id === match[1])
      return { id: match[1]!, status: match[2]!, title: match[3]!.replace(/  <- next$/, ''), waiting: previous?.waiting ?? false }
    }) }
  }
  if (call.name === 'TaskCreateMany' || call.name === 'TaskCreate') {
    // Official task tools return native ids in their receipt, not their empty details object.
    const created = call.name === 'TaskCreate'
      ? [...text.matchAll(/^Task #(\d+) created successfully: (.+)$/gm)]
      : [...text.matchAll(/(?:^|\n)\s*#(\d+)\s+([^\n]+)/g)]
    const submitted = Array.isArray(args.tasks) ? args.tasks.map(object) : [args]
    const entries = created.map((match, index) => ({ id: match[1]!, title: match[2]!, status: 'pending', waiting: object(object(submitted[index]?.metadata).flowControl).waitForUser === true }))
    if (!entries.length) return next
    return { ...next, tasks: [...next.tasks.filter(task => !entries.some(entry => entry.id === task.id)), ...entries] }
  }
  if (call.name === 'TaskUpdate') {
    const id = String(args.taskId ?? '')
    return { ...next, tasks: next.tasks.map(task => task.id !== id ? task : {
      ...task, title: typeof args.subject === 'string' ? args.subject : task.title,
      status: typeof args.status === 'string' ? args.status : task.status,
      paused: typeof args.paused === 'boolean' ? args.paused : task.paused,
      waiting: typeof args.waitForUser === 'boolean' ? args.waitForUser : typeof object(object(args.metadata).flowControl).waitForUser === 'boolean' ? object(object(args.metadata).flowControl).waitForUser === true : task.waiting,
    }) }
  }
  if (call.name === 'agent_wait') {
    const receipt = object(event.data.meta)
    if (typeof receipt.token !== 'string' || typeof receipt.state !== 'string') return next
    const wait = { id: receipt.token, status: receipt.state,
      reason: typeof receipt.reason === 'string' ? receipt.reason : '',
      handles: Array.isArray(receipt.on) ? receipt.on.flatMap((value) => {
        const item = object(value)
        return typeof item.handle === 'string' ? [item.handle] : []
      }) : [],
    }
    return { ...next, waits: [...next.waits.filter(item => item.id !== wait.id), wait] }
  }
  const receipt = object(event.data.meta)
  if (receipt.action === 'list' && Array.isArray(receipt.tasks)) {
    const jobs = receipt.tasks.map(readJob)
    // A bounded manifest is not an inventory; malformed arrays cannot clear known work.
    if (jobs.some(job => job === undefined)) return next
    return { ...next, jobs: jobs.map(job => mergeJob(next.jobs, job!)) }
  }
  if (receipt.action === 'clear' && typeof receipt.removed === 'number') {
    // Clear only promises removal of finished jobs, not unidentified running observations.
    return { ...next, jobs: next.jobs.filter(job => !terminalJob(job.status)) }
  }
  const job = readJob(receipt.task)
  if (!job) return next
  return { ...next, jobs: [...next.jobs.filter(item => item.id !== job.id), mergeJob(next.jobs, job)] }
}
function terminalJob(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'stopped', 'killed'].includes(status)
}
function mergeJob(previous: JouzuActivity['jobs'], job: JouzuActivity['jobs'][number]): JouzuActivity['jobs'][number] {
  const old = previous.find(item => item.id === job.id)
  if (!old) return job
  const same = old.execution !== null && job.execution !== null ? old.execution === job.execution
    : old.startedAt !== null && old.startedAt === job.startedAt
  if (old.startedAt !== null && job.startedAt !== null && job.startedAt < old.startedAt) return old
  if (!same) return job
  if (old.updatedAt !== null && job.updatedAt !== null && job.updatedAt < old.updatedAt) return old
  if (terminalJob(old.status) && !terminalJob(job.status)) return old
  return { ...job, execution: job.execution ?? old.execution, work: job.work ?? old.work }
}
function readJob(value: unknown): JouzuActivity['jobs'][number] | undefined {
  const task = object(value)
  if (typeof task.id !== 'string' || typeof task.status !== 'string') return undefined
  return {
    execution: typeof object(task.flow).execution === 'string' ? String(object(task.flow).execution) : null,
    id: task.id, title: typeof task.title === 'string' ? task.title : typeof task.command === 'string' ? task.command : task.id,
    status: task.status, startedAt: typeof task.startedAt === 'number' ? task.startedAt : null,
    updatedAt: typeof task.updatedAt === 'number' ? task.updatedAt : null,
    exitCode: typeof task.exitCode === 'number' ? task.exitCode : null,
    work: typeof object(object(task.flow).work).id === 'string' ? String(object(object(task.flow).work).id) : null,
  }
}
/** Read-only activity projection rebuilt from ordinary tool history on refresh. */
export const activityProjection = {
  key: 'jouzuActivity', stateVersion: 4, stateSchema: schema,
  init: (): JouzuActivity => ({ tasks: [], jobs: [], waits: [], calls: [] }),
  apply: foldActivity,
  wire: { viewSchema: schema.omit({ calls: true }), view: ({ tasks, jobs, waits }: JouzuActivity) => ({ tasks, jobs, waits }) },
} satisfies ProjectionDefinition<'jouzuActivity', JouzuActivity>
