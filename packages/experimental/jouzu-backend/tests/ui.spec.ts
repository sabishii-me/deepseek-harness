import { expect, it } from 'vitest'
import { appendPluginRecord, pluginRecordOf, Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { emptyJouzuUi, jouzuUiProjection, receiveJouzuUi } from '../src/ui.ts'
const limits = { entries: 8, text: 4096 }
it('replaces and removes status/widgets without interpreting terminal or HTML content', () => {
  const first = receiveJouzuUi(emptyJouzuUi(), { type: 'extension_ui_request', method: 'setStatus', statusKey: 'flow', statusText: '\u001b[31mwaiting\u001b[0m' }, limits)!
  expect(first.statuses).toEqual([{ key: 'flow', text: 'waiting' }])
  const widget = receiveJouzuUi(first, { type: 'extension_ui_request', method: 'setWidget', widgetKey: 'task', widgetLines: ['<script>bad()</script>'], widgetPlacement: 'belowEditor' }, limits)!
  expect(widget.widgets[0]?.lines).toEqual(['<script>bad()</script>'])
  const removed = receiveJouzuUi(widget, { type: 'extension_ui_request', method: 'setStatus', statusKey: 'flow' }, limits)!
  expect(removed.statuses).toEqual([])
  expect(receiveJouzuUi(removed, { type: 'extension_ui_request', method: 'setWidget', widgetKey: 'task' }, limits)?.widgets).toEqual([])
})
it('retains notification and Flow as ignorable replayable presentation, not model input', () => {
  let state = receiveJouzuUi(emptyJouzuUi(), { type: 'extension_ui_request', method: 'notify', message: 'Paused', notifyType: 'warning' }, limits)!
  state = receiveJouzuUi(state, { type: 'message_end', message: { role: 'custom', customType: 'jouzu-flow', content: '{"kind":"work","content":"task 2"}' } }, limits)!
  const id = SessionId('ui-replay')
  const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false })
  appendPluginRecord(session, 'plugin:jouzu-backend/ui', state)
  // oxlint-disable-next-line typescript/no-deprecated -- Test inspects the committed plugin record.
  const event = session.snapshotEvents().at(-1)!
  expect(event.ignorable).toBe(true)
  expect(pluginRecordOf(event)?.type).toBe('plugin:jouzu-backend/ui')
  expect(jouzuUiProjection.apply(null, event)).toEqual({ ...state, receivedAt: event.time })
  expect(session.deriveMessages()).toEqual([])
})
it('rejects malformed or oversized native presentation and leaves questions to the answerer', () => {
  expect(receiveJouzuUi(emptyJouzuUi(), { type: 'extension_ui_request', method: 'confirm' }, limits)).toBeUndefined()
  expect(() => receiveJouzuUi(emptyJouzuUi(), { type: 'extension_ui_request', method: 'setWidget', widgetKey: 'x', widgetLines: [1] }, limits)).toThrow()
  expect(() => receiveJouzuUi(emptyJouzuUi(), { type: 'extension_ui_request', method: 'notify', message: 'long' }, { entries: 1, text: 1 })).toThrow('limit')
})
