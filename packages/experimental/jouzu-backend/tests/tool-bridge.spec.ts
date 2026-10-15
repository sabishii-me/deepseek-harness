import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import Agents from '@deepseek-ai/dsh-agent'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Llm from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import { mountNativeFactory } from '../src/factory-router.ts'
import { openToolBridge } from '../src/tool-bridge.ts'

it('executes only Session-visible admitted tools through the public pipeline, without duplicate execution', async () => {
  const ctx = new Context()
  await ctx.plugin(Llm); await ctx.plugin(Sessions); await ctx.plugin(Projections)
  await ctx.plugin(SystemPrompt); await ctx.plugin(Tools); await ctx.plugin(Agents)
  const factory = await mountNativeFactory(ctx)
  const handle = await factory.createAgent(ctx, { sessionId: SessionId('bridge-owner'), agentOptions: {} })
  let executions = 0, observed = ''
  handle.agent.ctx.tools.register(defineTool({ name:'bridge_echo',description:'Echo through DSH',parameters:{ text:{ type:'string',required:true } },output:{ schema:{ type:'string' },render:(_args,value)=>[{ type:'text',text:value }] },async execute(args,exec){executions++; observed=exec.agent!.id;return args.text} }))
  ctx.on('tools/pre-execute', (_exec,next)=>next())
  const started = Promise.withResolvers<void>(), cancelled = Promise.withResolvers<void>()
  handle.agent.ctx.tools.register(defineTool({ name:'bridge_wait',description:'Wait for cancellation',parameters:{},output:{ schema:{ type:'string' },render:(_args,value)=>[{ type:'text',text:value }] },async execute(_args,exec){started.resolve();await new Promise<void>((resolve)=>{if(exec.signal.aborted)resolve();else exec.signal.addEventListener('abort',()=>resolve(),{ once:true })});cancelled.resolve();return 'stopped'} }))
  handle.agent.ctx.tools.register(defineTool({ name:'bridge_fail',description:'Fail',parameters:{},output:{ schema:{ type:'string' },render:(_args,value)=>[{ type:'text',text:value }] },async execute(){throw new Error('DSH_TOOL_EXPECTED_FAILURE')} }))
  const bridge = await openToolBridge(ctx,handle.agent,['bridge_echo','bridge_wait','bridge_fail'],4096)
  const headers = { authorization:`Bearer ${bridge.token}`,'content-type':'application/json' }
  const call = (callId:string,name='bridge_echo')=>fetch(bridge.url+'/execute',{ method:'POST',headers,body:JSON.stringify({ callId,name,arguments:{ text:'DSH_TOOL_OK' } }) })
  try {
    expect((await fetch(bridge.url+'/tools')).status).toBe(403)
    const catalog=await (await fetch(bridge.url+'/tools',{ headers })).json()
    expect(catalog.tools.map((tool:{ name:string })=>tool.name)).toEqual(['bridge_echo','bridge_wait','bridge_fail'])
    expect(ctx.tools.schemas().map(tool=>tool.name)).not.toContain('bridge_echo')
    expect(await (await call('call-1')).json()).toMatchObject({ isError:false,content:[{ type:'text',text:'DSH_TOOL_OK' }] })
    expect(observed).toBe(handle.agent.id)
    expect((await call('call-1')).status).toBe(409)
    expect((await call('call-2','not-exposed')).status).toBe(403)
    expect(executions).toBe(1)
    expect(await (await call('fail-1','bridge_fail')).json()).toMatchObject({ isError:true })
    const abort = new AbortController()
    const waiting = fetch(bridge.url+'/execute',{ method:'POST',headers,signal:abort.signal,body:JSON.stringify({ callId:'wait-1',name:'bridge_wait',arguments:{} }) }).catch(()=>undefined)
    await started.promise
    abort.abort()
    await waiting
    await cancelled.promise
    expect(executions).toBe(1)
  } finally {await bridge.dispose();await handle.dispose();await ctx.fiber.dispose()}
})

it('refuses escalation and background arguments in the confined bridge scope', async () => {
  const ctx=new Context()
  for(const plugin of [Llm,Sessions,Projections,SystemPrompt,Tools,Agents]) await ctx.plugin(plugin)
  const factory=await mountNativeFactory(ctx)
  const handle=await factory.createAgent(ctx,{ sessionId:SessionId('restricted-http'),agentOptions:{} })
  ctx.provide('sandboxPolicy',{ resolve:()=>({ mode:'workspace-write' }) })
  let executions=0
  ctx.tools.register(defineTool({ name:'pwsh',description:'probe',parameters:{},output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text',text:v }] },async execute(){executions++;return 'ok'} }))
  const bridge=await openToolBridge(ctx,handle.agent,['pwsh'],4096,true)
  try{
    for(const extra of [{ sandbox_permissions:'danger-full-access' },{ run_in_background:true }]){
      const response=await fetch(bridge.url+'/execute',{ method:'POST',headers:{ authorization:`Bearer ${bridge.token}` },body:JSON.stringify({ callId:JSON.stringify(extra),name:'pwsh',arguments:{ command:'x',description:'test',...extra } }) })
      // 403: refused by the confined scope, not by a malformed request.
      expect(response.status).toBe(403)
    }
    expect(executions).toBe(0)
  }finally{await bridge.dispose();await handle.dispose();await ctx.fiber.dispose()}
})

it('bounds a confined bridge to its allowlist and to a still-confining policy', async () => {
  const ctx = new Context()
  for(const plugin of [Llm,Sessions,Projections,SystemPrompt,Tools,Agents]) await ctx.plugin(plugin)
  const factory = await mountNativeFactory(ctx)
  const handle = await factory.createAgent(ctx,{ sessionId:SessionId('confined-bridge'),agentOptions:{} })
  let executions = 0
  for(const name of ['read','write','edit','glob','grep','pwsh']) {
    handle.agent.ctx.tools.register(defineTool({ name,description:name,parameters:{},output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text',text:v }] },async execute(){executions++;return name} }))
  }
  // A tool the host can run but the confined surface must not expose.
  handle.agent.ctx.tools.register(defineTool({ name:'bg_task',description:'background',parameters:{},output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text',text:v }] },async execute(){executions++;return 'spawned'} }))
  // A confined bridge resolves the live policy per call, so the host service
  // must be present: its absence is a configuration fault, not an admission.
  ctx.provide('sandboxPolicy',{ resolve:()=>({ mode:'workspace-write',workspaceRoot:process.cwd(),sessionId:handle.agent.session.id }) })
  const bridge = await openToolBridge(ctx,handle.agent,['read','write','edit','glob','grep','pwsh'],4096,true)
  const headers = { authorization:`Bearer ${bridge.token}`,'content-type':'application/json' }
  const call = (name:string,args:object)=>fetch(bridge.url+'/execute',{ method:'POST',headers,body:JSON.stringify({ callId:name,name,arguments:args }) })
  try {
  // Every allowlisted file/search tool is reachable: an earlier build admitted
  // only `pwsh` and `write` and answered 403 for the rest, which read as a
  // sandbox denial rather than the bridge's own limit.
    for(const name of ['read','write','edit','glob','grep','pwsh']) {
      expect((await call(name,{})).status, `${name} must be admitted`).toBe(200)
    }
    // A host tool outside the confined surface is refused even though it exists.
    expect((await call('bg_task',{})).status).toBe(403)
    // Only the allowlisted calls reached execution.
    expect(executions).toBe(6)
  } finally {await bridge.dispose();await handle.dispose();await ctx.fiber.dispose()}
})
