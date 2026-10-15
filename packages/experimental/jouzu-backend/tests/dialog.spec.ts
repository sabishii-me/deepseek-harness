import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { answerJouzuDialog } from '../src/dialog.ts'

async function fixture(answers: { id: string; selected: string[]; custom?: string }[]) {
  const ctx = new Context()
  const ask = vi.fn(async () => ({ answers }))
  ctx.provide('userQuestions', { ask })
  return { ctx, ask }
}
// The mock question service does not dereference the Agent; identity is forwarded unchanged.
const agent = {} as Agent
it('routes select through native DSH questions and preserves the chosen option', async () => {
  const f = await fixture([{ id: 'q', selected: ['Keep'] }])
  try {
    const reply = await answerJouzuDialog(f.ctx, agent, { type: 'extension_ui_request', method: 'select', id: 'q', title: 'Choose', options: ['Keep', 'Discard'] }, new AbortController().signal)
    expect(reply).toEqual({ type: 'extension_ui_response', id: 'q', value: 'Keep' })
    expect(f.ask.mock.calls[0]).toEqual([expect.objectContaining({ agent, questions: [{ id: 'q', question: 'Choose', options: [{ label: 'Keep' }, { label: 'Discard' }] }] })])
  } finally { await f.ctx.fiber.dispose() }
})
it.each(['input', 'editor'])('routes %s free text through the existing question answerer', async (method) => {
  const f = await fixture([{ id: 'q', selected: [], custom: 'user reply' }])
  try {
    expect(await answerJouzuDialog(f.ctx, agent, { type: 'extension_ui_request', method, id: 'q', title: 'Text' }, new AbortController().signal)).toEqual({ type: 'extension_ui_response', id: 'q', value: 'user reply' })
  } finally { await f.ctx.fiber.dispose() }
})
it('does not interpret free-form text as confirmation or accept an unoffered select option', async () => {
  const f = await fixture([{ id: 'q', selected: ['unexpected'], custom: 'yes' }])
  try {
    expect(await answerJouzuDialog(f.ctx, agent, { method: 'confirm', id: 'q', title: 'Confirm' }, new AbortController().signal)).toEqual({ type: 'extension_ui_response', id: 'q', confirmed: false })
    expect(await answerJouzuDialog(f.ctx, agent, { method: 'select', id: 'q', title: 'Choose', options: ['Keep'] }, new AbortController().signal)).toEqual({ type: 'extension_ui_response', id: 'q', cancelled: true })
  } finally { await f.ctx.fiber.dispose() }
})
it('cancels rather than approving when the owner is aborted before answer delivery', async () => {
  const f = await fixture([{ id: 'q', selected: ['Yes'] }])
  const controller = new AbortController(); controller.abort()
  try {
    expect(await answerJouzuDialog(f.ctx, agent, { method: 'confirm', id: 'q', title: 'Confirm' }, controller.signal)).toEqual({ type: 'extension_ui_response', id: 'q', cancelled: true })
  } finally { await f.ctx.fiber.dispose() }
})
