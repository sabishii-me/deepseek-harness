/** Presentational task list shared by native Todo and external-backend work views. */
import type { ReactNode } from 'react'
import { IconChecklistOutlineRegular, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './TaskList.module.css'

/** One observed task; labels and execution semantics belong to the caller. */
export interface TaskListItem {
  id: string
  title: string
  state: StateDotState
  statusLabel: string
  status?: string
  description?: string
}
/** Controlled list presentation, with no task mutation or persistence. */
export interface TaskListProps {
  title: string
  summary: string
  items: readonly TaskListItem[]
  open: boolean
  onToggle: () => void
  footer?: ReactNode
}
/** Render the shared Todo header and rows; an empty list has no chrome.
 * @param props - localized labels, observed rows and controlled disclosure.
 * @returns compact task card or null when empty.
 */
export function TaskList({ title, summary, items, open, onToggle, footer }: TaskListProps) {
  if (!items.length) return null
  return <section className={css.root} aria-label={title}>
    <div className={css.body}>
      <button type="button" className={css.header} aria-expanded={open} onClick={onToggle}>
        <span className={css.lead} aria-hidden><IconChecklistOutlineRegular /></span>
        <span className={css.title}>{title}</span>
        <span className={css.progress}>{summary}</span>
        <span className={css.chevron} aria-hidden>{open ? <IconChevronDownOutlineRegular /> : <IconChevronUpOutlineRegular />}</span>
      </button>
      {open && <>
        <ul className={css.list}>{items.map(item => <li key={item.id} className={css.item} data-status={item.status}>
          <span className={css.glyph} role="img" aria-label={item.statusLabel}><StateDot state={item.state} /></span>
          <div className={css.text}><div className={css.content}>{item.title}</div>
            {item.description && <div className={css.description}>{item.description}</div>}
          </div>
        </li>)}</ul>
        {footer}
      </>}
    </div>
  </section>
}
