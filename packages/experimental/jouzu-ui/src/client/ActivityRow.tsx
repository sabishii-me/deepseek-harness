/** Shared DSH process-row presentation for native observations and tool receipts. */
import { useState, type ReactNode } from 'react'
import { DisclosureRow, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ActivityRow.module.css'

/** Display one activity using the same disclosure and status primitive as DSH tools.
 * @param props - localized title, summary, observed status and optional detail content.
 * @returns compact activity row with collapsed diagnostic details.
 */
export function ActivityRow({ title, summary, state, children }: {
  title: string; summary?: string | undefined; state: StateDotState; children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return <DisclosureRow icon={<StateDot state={state} />} title={title} open={open}
    expandable={children !== undefined} expandOnRowClick onToggle={() => setOpen(value => !value)}
    collapsedContent={summary} running={state === 'ongoing'}>
    <div className={css.body}>{children}</div>
  </DisclosureRow>
}
