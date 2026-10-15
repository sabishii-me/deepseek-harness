/** Structured native Flow reports. Raw transport fields are not the primary presentation. */
import { ActivityRow } from './ActivityRow.tsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
/** Render known native result/wait/work records without interpreting them as commands.
 * @param props - native retained text and localized labels.
 * @returns structured report or a plain-text fallback for unknown extension output.
 */
export function FlowReport({ text, t }: { text: string } & PropsLocale<'jouzu'>) {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch (error) { void error; return <p>{text}</p> }
  const envelope = record(parsed)
  const content = record(envelope?.content)
  if (envelope?.kind === 'result' && content && Array.isArray(content.sample)) {
    return <section aria-label={t('results')}>
      {content.sample.map((value, index) => {
        const item = record(value)
        if (!item) return null
        const status = item.status === 'success' ? 'done' : item.status === 'failure' ? 'error' : 'idle'
        const title = typeof item.title === 'string' ? item.title : t('results')
        return <ActivityRow key={index} title={title} state={status}>
          {typeof item.reference === 'string' && <p>{t('logReference')}: {item.reference}</p>}
          {Array.isArray(item.warnings) && item.warnings.filter((warning): warning is string => typeof warning === 'string').map((warning, i) => <p key={i} role="alert">{warning}</p>)}
        </ActivityRow>
      })}
      {typeof content.omitted === 'number' && content.omitted > 0 && <p>{t('omitted')}: {content.omitted}</p>}
    </section>
  }
  if ((envelope?.kind === 'work' || envelope?.kind === 'alert') && typeof envelope.content === 'string') return <ActivityRow title={envelope.content} state={envelope.kind === 'alert' ? 'warning' : 'idle'} />
  const wait = record(content?.wait)
  if (envelope?.kind === 'wait' && wait) return <section aria-label={t('waiting')}>
    <ActivityRow title={t('waiting')} summary={typeof wait.reason === 'string' ? wait.reason : undefined}
      state={wait.state === 'resolved' ? 'done' : wait.state === 'failed' ? 'error' : 'idle'}>
      <ul>{Array.isArray(wait.observations) && wait.observations.map((value, index) => {
        const item = record(value)
        return <li key={index}>{[item?.handle, item?.state, item?.health].filter(v => typeof v === 'string').join(' · ')}</li>
      })}</ul>
    </ActivityRow>
  </section>
  return <ActivityRow title={t('unrecognized')} state="idle"><p>{text}</p></ActivityRow>
}
