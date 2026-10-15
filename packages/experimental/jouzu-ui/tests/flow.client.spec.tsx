// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { FlowReport } from '../src/client/Flow.tsx'
import { JouzuTool } from '../src/client/Tool.tsx'
import { en } from '../src/client/locales.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
afterEach(cleanup)
const t: TranslateNS<'jouzu'> = key => key in en ? en[key as keyof typeof en] : key
it('presents the reported background failure without exposing routing JSON as the UI', async () => {
  const text = JSON.stringify({ flowInput: ['jouzu-flow', 'scope'], kind: 'result', content: {
    total: 1, counts: { success: 0, failure: 1, cancelled: 0 }, manifest: 'flow-results:digest',
    sample: [{ id: 'bg-result:id', producer: 'bg', status: 'failure', title: 'charakuru-app: failed (exit 127)', reference: 'C:/logs/bg-1.log', warnings: [] }], omitted: 0,
  } })
  const view = render(<FlowReport text={text} t={t} />)
  expect(screen.getByText('charakuru-app: failed (exit 127)')).toBeTruthy()
  expect(view.container.textContent).not.toContain('flowInput')
  expect(view.container.textContent).not.toContain('manifest')
  await expect(view.container.textContent).toMatchFileSnapshot('./expected/flow-failure.txt')
})
it.each(['TaskCreateMany', 'TaskUpdate', 'bg_task', 'agent_wait'])('renders a visible %s lifecycle card', (toolName) => {
  // The component reads only the standard block/name owner fields.
  const props = { toolName, phase: 'result', block: {
    kind: 'tool-result', call: { name: toolName, argsRaw: JSON.stringify({ tasks: [{ subject: 'Build app' }], taskId: 1, status: 'in_progress', action: 'start', command: 'build', on: [{ handle: 'bg-1', producer: 'bg', until: 'exit' }] }) },
    content: [{ type: 'text', text: 'Native result' }], isError: false,
  } } as ToolCallViewProps
  render(<JouzuTool {...props} t={t} />)
  expect(screen.getByRole('region', { name: toolName })).toBeTruthy()
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getByText('Native result')).toBeTruthy()
})
