// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { LiveProgress } from '../src/client/LiveProgress.tsx'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
it('shows activity immediately and reasoning before settlement, then removes live content', () => {
  let running=true, text='', status='running',preset='jouzu'
  const props={ useSession:((select:Function)=>select({ running })) as never,useProjection:((key:string)=>key==='agentPreset'?preset:null) as never,useChat:((select:Function)=>select({ order:['assistant'],nodes:{ get:()=>({ kind:'assistant-step',data:{ status,blocks:[{ kind:'reasoning',text }] } }) } })) as never,t:((key:keyof typeof en)=>en[key]) as never }
  const view=render(<LiveProgress {...props}/> )
  expect(screen.getByRole('status').textContent).toBe(en.liveWorking)
  text='Reasoning arriving before the answer';view.rerender(<LiveProgress {...props}/> )
  expect(screen.getByText(text)).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe(en.liveThinking)
  status='settled';view.rerender(<LiveProgress {...props}/> )
  expect(screen.queryByText(text)).toBeNull()
  running=false;view.rerender(<LiveProgress {...props}/> )
  expect(screen.getByText(text)).toBeTruthy()
  expect(screen.getByText(en.thinkingRecorded)).toBeTruthy()
  running=true;preset='standard';view.rerender(<LiveProgress {...props}/> )
  expect(view.container.textContent).toBe('')
})
