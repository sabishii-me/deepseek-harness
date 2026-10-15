import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { openModelBridge } from '../src/model-bridge.ts'

it('delivers the first HTTP chunk before upstream completion and aborts on disconnect', async () => {
  const ctx = new Context(), aborted = Promise.withResolvers<void>()
  let ended = false
  class Slow extends LlmAdapter {
    override async *stream(options: import('@deepseek-ai/dsh-llm').GenerateOptions): AsyncIterable<import('@deepseek-ai/dsh-llm').StreamChunk> {
      yield { type:'text-delta',index:0,text:'EARLY' }
      await new Promise<void>((resolve) => { if(options.signal?.aborted)resolve();else options.signal?.addEventListener('abort',()=>resolve(),{ once:true }) })
      ended=true; aborted.resolve()
      yield { type:'finish',reason:{ kind:'aborted' } }
    }
  }
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['test'],new Slow())
  const bridge = await openModelBridge(ctx,()=>({ provider:'test',model:'test' }),{ maxBytes:65536,timeoutMs:10000 })
  try {
    const response=await fetch(bridge.url+'/chat/completions',{ method:'POST',headers:{ authorization:`Bearer ${bridge.token}`,'content-type':'application/json' },body:JSON.stringify({ model:'selected',stream:true,messages:[{ role:'user',content:'test' }] }) })
    const reader=response.body!.getReader();let text=''
    while(!text.includes('EARLY')){const item=await reader.read();if(item.done)throw Error('Missing early delta');text+=new TextDecoder().decode(item.value)}
    expect(ended).toBe(false)
    await reader.cancel()
    await aborted.promise
    expect(ended).toBe(true)
  }finally{await bridge.dispose();await ctx.fiber.dispose()}
},15000)

it('settles canonicalized tool JSON over HTTP through the real LlmRuntime', async () => {
  const { ToolCallId } = await import('@deepseek-ai/dsh-llm')
  const ctx = new Context()
  class ToolAdapter extends LlmAdapter {
    override async *stream(): AsyncIterable<import('@deepseek-ai/dsh-llm').StreamChunk> {
      const id = ToolCallId('bash-roundtrip')
      yield { type:'tool-call-delta',index:0,id,name:'bash',argumentsDelta:'{ "command": "pwd && ls" }' }
      yield { type:'block-end',index:0,block:{ type:'tool-call',id,name:'bash',arguments:'{"command":"pwd && ls"}' } }
      yield { type:'usage',usage:{ inputTokens:10,outputTokens:12,reasoningTokens:7 } }
      yield { type:'finish',reason:{ kind:'tool-calls' } }
    }
  }
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['test'], new ToolAdapter())
  const bridge = await openModelBridge(ctx,()=>({ provider:'test',model:'test' }),{ maxBytes:65536,timeoutMs:10000 })
  try {
    const response = await fetch(bridge.url+'/chat/completions',{ method:'POST',headers:{ authorization:`Bearer ${bridge.token}`,'content-type':'application/json' },body:JSON.stringify({ model:'selected',stream:true,messages:[{ role:'user',content:'run bash' }] }) })
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('"finish_reason":"tool_calls"')
    expect(body).toContain('data: [DONE]')
    expect(body).toContain('"completion_tokens":12')
    expect(body).toContain('"reasoning_tokens":7')
    const frames = body.split('\n').filter(line=>line.startsWith('data: {')).map(line=>JSON.parse(line.slice(6)))
    const args = frames.flatMap(frame=>frame.choices).flatMap(choice=>choice.delta.tool_calls??[]).map(call=>call.function.arguments??'').join('')
    expect(JSON.parse(args)).toEqual({ command:'pwd && ls' })
  } finally { await bridge.dispose(); await ctx.fiber.dispose() }
})
