import { expect, it } from 'vitest'
import { appendPluginRecord, Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { deliveryProjection } from '../src/delivery.ts'
import type { JouzuDeliveryView } from '../src/ui-types.ts'
it('keeps acknowledgement, assistant output and interruption independent across replay', () => {
  const id = SessionId('delivery-test')
  const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false })
  let state: JouzuDeliveryView | null = null
  const fold = () => {
    // oxlint-disable-next-line typescript/no-deprecated -- Replay test reads the committed event.
    state = deliveryProjection.apply(state, session.snapshotEvents().at(-1)!)
    return state
  }
  appendPluginRecord(session, 'plugin:jouzu-backend/delivery', { turn: 1, phase: 'submitted' })
  expect(fold()).toMatchObject({ acknowledged: false, assistantObserved: false })
  session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createAssistantMessage({ content: [{ type: 'text', text: 'reply' }], source: { provider: 'native', model: 'test' } }) }, { surfaceOp: 'append' })
  expect(fold()).toMatchObject({ acknowledged: false, assistantObserved: true })
  appendPluginRecord(session, 'plugin:jouzu-backend/delivery', { turn: 1, phase: 'acknowledged' })
  expect(fold()).toMatchObject({ acknowledged: true, assistantObserved: true })
  session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'interrupted connection' } } })
  expect(fold()).toMatchObject({ outcome: 'error', assistantObserved: true })
  appendPluginRecord(session, 'plugin:jouzu-backend/delivery', { turn: 2, phase: 'submitted' })
  expect(fold()).toMatchObject({ turn: 2, acknowledged: false, assistantObserved: false })
})
