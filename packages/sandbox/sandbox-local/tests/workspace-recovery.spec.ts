import { expect,it,vi } from 'vitest'
import { recoverWorkspaceGrant } from '../src/workspace-recovery.ts'
const policy={ mode:'workspace-write',workspaceRoot:'C:\\workspace' } as const
const denied=()=>Object.assign(new Error('SetNamedSecurityInfoW failed (Win32 5): grantWrite(C:\\workspace)'),{ api:'SetNamedSecurityInfoW',win32Code:5 })
it('retries only provisioning after verified repair, preserving confined argv',async()=>{
  const provision=vi.fn().mockImplementationOnce(()=>{throw denied()}).mockReturnValue(['sandbox','--','pwsh'])
  const repair=vi.fn(async()=>true)
  expect(await recoverWorkspaceGrant(provision,{ policy },repair)).toEqual(['sandbox','--','pwsh'])
  expect(provision).toHaveBeenCalledTimes(2);expect(repair).toHaveBeenCalledOnce()
})
it('does not retry a denied repair or fall back to unconfined argv',async()=>{
  const provision=vi.fn(()=>{throw denied()})
  await expect(recoverWorkspaceGrant(provision,{ policy },async()=>false)).rejects.toMatchObject({ code:'SANDBOX_UNAVAILABLE' })
  expect(provision).toHaveBeenCalledOnce()
})
it('does not retry indefinitely if repaired provisioning still fails',async()=>{
  const provision=vi.fn(()=>{throw denied()}),repair=vi.fn(async()=>true)
  await expect(recoverWorkspaceGrant(provision,{ policy },repair)).rejects.toThrow('verification failed')
  expect(provision).toHaveBeenCalledTimes(2);expect(repair).toHaveBeenCalledOnce()
})
it('does not repair unrelated failures or another directory',async()=>{
  const repair=vi.fn(async()=>true)
  for(const error of [new Error('spawn failed'),Object.assign(denied(),{ message:'grantWrite(C:\\other)' })]){
    await expect(recoverWorkspaceGrant(()=>{throw error},{ policy },repair)).rejects.toBe(error)
  }
  expect(repair).not.toHaveBeenCalled()
})
it('cancellation after repair prevents retry',async()=>{
  const abort=new AbortController(),provision=vi.fn(()=>{throw denied()})
  await expect(recoverWorkspaceGrant(provision,{ policy,signal:abort.signal },async()=>{abort.abort();return true})).rejects.toThrow()
  expect(provision).toHaveBeenCalledOnce()
})
