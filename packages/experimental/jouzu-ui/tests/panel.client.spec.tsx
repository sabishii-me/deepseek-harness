// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { JouzuPanel } from '../src/client/Panel.tsx'
import { en } from '../src/client/locales.ts'
import type { JouzuActivityView } from '@deepseek-ai/dsh-experimental-jouzu-backend/ui-types'
afterEach(cleanup)
function mount(activity: JouzuActivityView | null, backend = 'jouzu') {
  // The panel reads several jouzuUi fields; a fixture that omits them exercises
  // an impossible state rather than the component's real contract.
  const ui = { statuses: [], widgets: [], flow: null, lifecycle: 'observed' }
  return render(<JouzuPanel useProjection={((key: string) => key === 'agentBackend' ? backend : key === 'jouzuActivity' ? activity : ui) as never} t={key => key in en ? en[key as keyof typeof en] : key} />)
}
it('renders real unfinished task observations through the shared Todo list', async () => {
  const view = mount({ tasks: [{ id: '1', title: 'Build app', status: 'in_progress', waiting: false }], jobs: [], waits: [] })
  expect(screen.getByText('Build app')).toBeTruthy()
  expect(screen.getByText(en.lastRunning)).toBeTruthy()
  expect(view.container.textContent).not.toMatch(/mock|Native Flow diagnostic|0\/0/i)
  await expect(view.container.textContent + '\n').toMatchFileSnapshot('./expected/session-flow.txt')
  fireEvent.click(screen.getByRole('button', { expanded: true }))
  expect(screen.queryByText('Build app')).toBeNull()
})
it('renders nothing for unknown, empty, completed-only or native DSH state', () => {
  for (const activity of [null, { tasks: [], jobs: [], waits: [] }, { tasks: [{ id: '1', title: 'Done', status: 'completed', waiting: false }], jobs: [], waits: [] }]) {
    const view = mount(activity)
    expect(view.container.textContent).toBe('')
    view.unmount()
  }
  expect(mount({ tasks: [], jobs: [], waits: [] }, 'dsh').container.textContent).toBe('')
})
