/** Receipt-backed work display using the same presentation as the native Todo dock. */
import { useState } from 'react'
import { ActivityRow } from './ActivityRow.tsx'
import { TaskList, type TaskListItem } from './TaskList.tsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-agent/types'
import type { JouzuActivityView } from '@deepseek-ai/dsh-experimental-jouzu-backend/ui-types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import css from './Panel.module.css'

const terminal = new Set(['completed', 'failed', 'cancelled', 'deleted', 'stopped', 'resolved', 'expired'])
/** Derive observed unfinished work without treating missing observations as live progress.
 * @param activity - Session projection, absent until loaded.
 * @param t - localized task descriptions.
 * @returns rows for unfinished work only; completed receipts remain in the transcript.
 */
export function workRows(activity: JouzuActivityView | null | undefined, t: TranslateNS<'jouzu'>): TaskListItem[] {
  if (!activity) return []
  return [
    ...activity.tasks.filter(task => !terminal.has(task.status)).map(task => ({
      id: `task:${task.id}`, title: task.title, state: task.waiting || task.paused ? 'warning' as const : 'idle' as const,
      statusLabel: t(task.paused ? 'paused' : task.waiting ? 'needsYou' : task.status === 'in_progress' ? 'lastRunning' : 'pending'),
      description: t(task.paused ? 'paused' : task.waiting ? 'needsYou' : task.status === 'in_progress' ? 'lastRunning' : 'pending'),
    })),
    ...activity.jobs.filter(job => !terminal.has(job.status)).map(job => ({
      id: `job:${job.id}`, title: job.title, state: 'idle' as const,
      statusLabel: t('lastRunning'), description: t('lastRunning'),
    })),
    ...activity.waits.filter(wait => !terminal.has(wait.status)).map(wait => ({
      id: `wait:${wait.id}`, title: wait.reason || t('waiting'), state: 'warning' as const,
      statusLabel: t('waiting'), description: wait.handles.map(handle => activity.jobs.find(job => job.id === handle)?.title ?? handle).join(' · '),
    })),
  ]
}

/** Render unfinished native observations; opening the dock never starts native work.
 * @param props - Session projection hooks and locale labels.
 * @returns shared task card or nothing for native DSH, empty or terminal-only observations.
 */
export function JouzuPanel({ useProjection, t }: Pick<PropsRuntime<'conversation.input.dock'>, 'useProjection'> & PropsLocale<'jouzu'>) {
  const [open, setOpen] = useState(true)
  const activity = useProjection('jouzuActivity')
  const ui = useProjection('jouzuUi')
  const lifecycle = ui?.lifecycle
  const rows = workRows(activity, t)
  if (!ui || (!rows.length && !activity?.jobs.length && !ui.flow && !ui.statuses.length && !ui.widgets.length)) return null
  let flow = ui.flow
  if (flow) {
    try { const parsed: unknown = JSON.parse(flow); if (parsed && typeof parsed === 'object' && 'content' in parsed && typeof parsed.content === 'string') flow = parsed.content } catch { /* Older native Flow records contain plain text. */ }
  }
  return <div className={css.dock}>
    {flow && <details><summary>{t('flow')}</summary><p>{t('observed')}</p><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{flow}</div></details>}
    {ui.statuses.map(status => <p key={status.key}>{status.text}</p>)}
    {ui.widgets.map(widget => <details key={widget.key}><summary>{t('widgets')}</summary><div style={{ whiteSpace: 'pre-wrap' }}>{widget.lines.join(String.fromCharCode(10))}</div></details>)}
    {activity?.jobs.some(job => terminal.has(job.status)) && <details>
      <summary>{t('results')}</summary>
      {activity.jobs.filter(job => terminal.has(job.status)).map(job => <ActivityRow key={job.execution ?? job.id}
        title={job.title} state={job.status === 'completed' ? 'done' : job.status === 'failed' ? 'error' : 'warning'}
        summary={t(job.status === 'completed' ? 'success' : job.status === 'failed' ? 'failure' : 'cancelled')}>
        {job.exitCode !== null && <p>{t('exitCode')}: {job.exitCode}</p>}
      </ActivityRow>)}
    </details>}
    <TaskList title={t('work')} summary={lifecycle === 'closed' || lifecycle === 'unavailable' ? t(lifecycle) : t('recordedWork')}
      items={rows} open={open} onToggle={() => setOpen(value => !value)} />
  </div>
}
