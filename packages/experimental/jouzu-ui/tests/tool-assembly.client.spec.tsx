// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolChatData } from '../../../client/ui-chat/src/client/contract/chat-nodes.ts'
import { toolDefinition } from '../../../client/ui-chat/src/client/conversation-nodes/tool.ts'
import { chatViewDefinition } from '../../../client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts'
import { unknownFallbackDefinition } from '../../../client/ui-chat/src/client/conversation-nodes/fallback.ts'
import { turnProcessDefinition } from '../../../client/ui-chat/src/client/conversation-nodes/turn-process.ts'
import { JouzuTool } from '../src/client/Tool.tsx'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
it('assembles and renders all four native tools without a DSH request header', async () => {
  const id = SessionId('jouzu-tool-replay')
  const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  for (const name of ['TaskCreateMany', 'TaskUpdate', 'bg_task', 'agent_wait']) {
    const callId = ToolCallId(name)
    session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: '{}' })
    session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'Native receipt' }], isError: false }) }, { surfaceOp: 'append' })
  }
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const assembler = new ConversationNodeAssembler({ entries: () => [toolDefinition, turnProcessDefinition], fallbackEntry: () => unknownFallbackDefinition }, { entries: () => [chatViewDefinition] })
  // oxlint-disable-next-line typescript/no-deprecated -- Recorded Session replay fixture.
  assembler.replaceWindow(session.snapshotEvents().map(event => ({ type: 'event' as const, event })), false)
  assembler.activateTarget('chat')
  const chat = assembler.snapshot('chat') as ChatSnapshot
  const nodes = chat.nodes.values().filter(node => node.kind === 'tool-call')
  expect(nodes).toHaveLength(4)
  for (const node of nodes) {
    expect(node.visibility).toBe('visible')
    if (node.kind !== 'tool-call') throw new Error('Expected tool node')
    const root = (node.data as ToolChatData).root
    if (!('kind' in root)) throw new Error('Expected settled receipt')
    const props = { block: root, toolName: root.name, phase: 'result' } as ToolCallViewProps
    render(<JouzuTool {...props} t={key => key in en ? en[key as keyof typeof en] : key} />)
    expect(screen.getByRole('region', { name: root.name })).toBeTruthy()
  }
  await expect(document.body.textContent).toMatchFileSnapshot('./expected/native-tools-replay.txt')
})
