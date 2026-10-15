/** Native Jouzu tools rendered in the existing keyed tool-call slot. */
import { ActivityRow } from './ActivityRow.tsx'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
/** Present task batches, task updates, background actions and waits with their actual result.
 * @param props - standard tool lifecycle and localized labels.
 * @returns native tool card; never starts or cancels native work.
 */
export function JouzuTool({ block, toolName, t }: ToolCallViewProps & PropsLocale<'jouzu'>) {
  const call = 'kind' in block ? block.call : block.phase === 'start' ? block : null
  let args: Record<string, unknown> = {}
  if (call) { try { args = object(JSON.parse(call.argsRaw)) } catch (error) { void error } }
  const result = 'kind' in block ? block : undefined
  const tasks = Array.isArray(args.tasks) ? args.tasks : toolName === 'TaskCreate' ? [args] : []
  const phase = result ? result.isError ? 'failure' : 'success' : 'running'
  const title = toolName === 'TaskCreateMany' || toolName === 'TaskCreate' ? t('taskCreate')
    : toolName === 'TaskUpdate' ? t('taskUpdate') : toolName === 'TaskList' ? t('taskList')
      : toolName === 'bg_task' ? t('background') : t('waiting')
  const summary = typeof args.command === 'string' ? args.command
    : typeof args.status === 'string' ? args.status : undefined
  return <section aria-label={toolName}>
    <ActivityRow title={title} summary={summary} state={phase === 'running' ? 'ongoing' : phase === 'failure' ? 'error' : 'done'}>
      {tasks.length > 0 && <ul>{tasks.map((value, index) => {
        const task = object(value)
        return <li key={index}>{String(task.subject ?? task.title ?? '')}</li>
      })}</ul>}
      {Array.isArray(args.on) && <ul>{args.on.map((value, index) => { const item = object(value); return <li key={index}>{[item.handle, item.until].filter(v => typeof v === 'string').join(' · ')}</li> })}</ul>}
      {result && <p>{result.content.filter(part => part.type === 'text').map(part => part.type === 'text' ? part.text : '').join(String.fromCharCode(10))}</p>}
    </ActivityRow>
  </section>
}
