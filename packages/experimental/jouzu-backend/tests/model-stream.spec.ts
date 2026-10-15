import { expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ModelStreamEncoder } from '../src/model-stream.ts'
it('emits text before settlement without duplicating the final block', () => {
  const encoder = new ModelStreamEncoder()
  expect(encoder.push({ type:'text-delta',index:0,text:'first' })).toEqual([{ content:'first' }])
  expect(encoder.push({ type:'block-end',index:0,block:{ type:'text',text:'first last' } })).toEqual([{ content:' last' }])
})
it('keeps tool arguments incremental and handles complete-only tools', () => {
  const encoder = new ModelStreamEncoder(), id = ToolCallId('call')
  encoder.push({ type:'tool-call-delta',index:2,id,name:'echo',argumentsDelta:'{"x":' })
  expect(encoder.push({ type:'block-end',index:2,block:{ type:'tool-call',id,name:'echo',arguments:'{"x":1}' } })).toMatchObject([{ tool_calls:[{ index:0,function:{ arguments:'1}' } }] }])
  expect(encoder.push({ type:'block-end',index:4,block:{ type:'tool-call',id:ToolCallId('two'),name:'list',arguments:'{}' } })).toMatchObject([{ tool_calls:[{ index:1,function:{ arguments:'{}' } }] }])
})
it('does not concatenate the tool name twice in a streamed tool call', () => {
  const encoder = new ModelStreamEncoder(), id=ToolCallId('one')
  const frames=[
    ...encoder.push({ type:'tool-call-delta',index:0,id,name:'TaskList',argumentsDelta:'{' }),
    ...encoder.push({ type:'tool-call-delta',index:0,id,name:'TaskList',argumentsDelta:'}' }),
    ...encoder.push({ type:'block-end',index:0,block:{ type:'tool-call',id,name:'TaskList',arguments:'{}' } }),
  ]
  expect(JSON.stringify(frames).match(/TaskList/g)).toHaveLength(1)
})
it('accepts canonicalized final tool arguments after streaming equivalent JSON', () => {
  const encoder = new ModelStreamEncoder(), id = ToolCallId('bash-call')
  encoder.push({ type:'tool-call-delta',index:0,id,name:'bash',argumentsDelta:'{ "command": "pwd && ls" }' })
  expect(encoder.push({ type:'block-end',index:0,block:{ type:'tool-call',id,name:'bash',arguments:'{"command":"pwd && ls"}' } })).toEqual([])
})
it('rejects a final tool argument value that differs from the streamed JSON', () => {
  const encoder = new ModelStreamEncoder(), id = ToolCallId('bash-call')
  encoder.push({ type:'tool-call-delta',index:0,id,name:'bash',argumentsDelta:'{"command":"pwd"}' })
  expect(() => encoder.push({ type:'block-end',index:0,block:{ type:'tool-call',id,name:'bash',arguments:'{"command":"ls"}' } })).toThrow('Model rewrote streamed tool call')
})
