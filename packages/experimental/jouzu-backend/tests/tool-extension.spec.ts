import { expect, it } from 'vitest'
import { toolBridgeExtension } from '../src/tool-extension.ts'

it('registers namespaced tools and preserves deferred text, errors and termination through the public extension', async () => {
  const extension = await import(`data:text/javascript;base64,${Buffer.from(toolBridgeExtension).toString('base64')}`)
  const tools: { name:string;execute:(id:string,args:object,signal:AbortSignal)=>Promise<unknown> }[]=[]
  const previousFetch=globalThis.fetch
  const requests: { url:string;signal:AbortSignal|null|undefined }[]=[]
  globalThis.fetch=async (input,options)=>{
    const url=String(input);requests.push({ url,signal:options?.signal })
    return Response.json(url.endsWith('/tools')?{ tools:[{ name:'echo',description:'Echo',parameters:{ type:'object',properties:{} } }] }:{ content:[{ type:'text',text:'result' }],additionalContexts:[{ content:[{ type:'text',text:'context' }] }],isError:true,meta:{ origin:'DSH' },concludesTurn:true })
  }
  try {
    await extension.default({ registerTool:(tool:typeof tools[number])=>tools.push(tool) })
    expect(tools[0]?.name).toBe('dsh_echo')
    const signal=new AbortController().signal
    expect(await tools[0]!.execute('call',{},signal)).toEqual({ content:[{ type:'text',text:'result' },{ type:'text',text:'context' }],isError:true,details:{ origin:'DSH' },terminate:true })
    expect(requests[1]?.signal).toBe(signal)
  } finally {globalThis.fetch=previousFetch}
})
