import { Context } from '@deepseek-ai/cordis'
import { expect,it,vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync,mkdirSync,readFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { LocalSandboxProvider } from '../src/index.ts'

it.skipIf(process.platform!=='win32')('self-heals an owned Modify-only workspace without approval, then runs inside and denies outside',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dsh-recovery-integration-')),workspace=join(root,'workspace'),outside=join(root,'outside.txt')
  mkdirSync(workspace)
  const sid=execFileSync('powershell.exe',['-NoProfile','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{ encoding:'utf8' }).trim()
  execFileSync('icacls.exe',[workspace,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)(M)`])
  const ctx=new Context(),request=vi.fn(async()=> 'allowed-once')
  ctx.provide('agents',{ currentInitiator:()=>({ id:'repair-test' }) })
  ctx.provide('approval',{ request })
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(LocalSandboxProvider)
  await new Promise(resolve=>setTimeout(resolve,20))
  try{
    const policy={ mode:'workspace-write',workspaceRoot:workspace,sessionId:'repair-test' } as const
    const command=`[IO.File]::WriteAllText('${join(workspace,'inside.txt')}','INSIDE_OK'); try { [IO.File]::WriteAllText('${outside}','OUTSIDE_BAD'); exit 9 } catch { Write-Output 'OUTSIDE_DENIED' }`
    const wrapped=await ctx.sandbox.confine(['powershell.exe','-NoProfile','-NonInteractive','-Command',command],policy as never)
    // The directory omits the caller's SID, so the label write is denied and the
    // grant self-heals by adding the caller's own full-control ACE (WRITE_DAC is
    // held). Approval is the fallback for repairs the caller cannot perform, so a
    // self-healing workspace must not prompt.
    expect(request).not.toHaveBeenCalled()
    const child=ctx.subprocess.spawn({ argv:wrapped.argv,cwd:workspace,stdio:{ stdin:'ignore',stdout:'pipe',stderr:'pipe' },graceMs:1000 })
    let stdout='',stderr='';child.stdout?.on('data',c=>stdout+=c);child.stderr?.on('data',c=>stderr+=c)
    const result=await child.done;await child.waitForExit()
    expect(result.exitCode,stderr).toBe(0)
    expect(stdout).toContain('OUTSIDE_DENIED')
    expect(readFileSync(join(workspace,'inside.txt'),'utf8')).toBe('INSIDE_OK')
    expect(()=>readFileSync(outside)).toThrow()
    await ctx.sandbox.confine(['powershell.exe','-Command','pwd'],policy as never)
    expect(request).not.toHaveBeenCalled()
  }finally{
    await ctx.fiber.dispose()
    execFileSync('icacls.exe',[workspace,'/grant:r',`*${sid}:(OI)(CI)F`])
    rmSync(root,{ recursive:true,force:true })
  }
})
