import { expect,it } from 'vitest'
import { toolExecutionRoutes,translateNativeToolArguments } from '../src/tool-execution-routes.ts'
it('retains native tools in Full access and selects DSH PowerShell and file routes when restricted',()=>{
  expect(toolExecutionRoutes('danger-full-access')).toEqual({ restricted:false,routes:{},intercept:[] })
  for(const mode of ['read-only','workspace-write'] as const){
    const plan=toolExecutionRoutes(mode)
    expect(plan.routes).toMatchObject({ powershell:'pwsh',write:'write' })
    expect(plan.intercept).toEqual(expect.arrayContaining(['bash','bg_task','subagent','user_bash']))
  }
})
it('translates PowerShell seconds and write paths without forwarding implicit escalation',()=>{
  expect(translateNativeToolArguments('powershell',{ command:'Get-Location',timeout:3,sandbox_permissions:'danger-full-access' })).toEqual({ command:'Get-Location',description:'Jouzu PowerShell execution',timeoutMs:3000 })
  expect(translateNativeToolArguments('write',{ path:'file.txt',content:'data' })).toEqual({ file_path:'file.txt',content:'data' })
  expect(()=>translateNativeToolArguments('powershell',{ command:'x',timeout:-1 })).toThrow()
  expect(()=>translateNativeToolArguments('bash',{ command:'echo x' })).toThrow()
})
