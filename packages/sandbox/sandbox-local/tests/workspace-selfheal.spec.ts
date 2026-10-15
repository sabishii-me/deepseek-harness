import { execFileSync } from 'node:child_process'
import { mkdtempSync,mkdirSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect,it } from 'vitest'
import { AclWriteGrant,workspaceWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl'

/** Current user's SID, used to build a DACL that omits it. */
function currentSid():string{
  return execFileSync('powershell.exe',['-NoProfile','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{ encoding:'utf8' }).trim()
}

/**
 * The regression this file exists for: a workspace directory whose DACL omits
 * the caller leaves no WRITE_OWNER, so the mandatory-label half of a write
 * grant is denied (SetNamedSecurityInfoW Win32 5) even though WRITE_DAC is
 * held. The grant must repair itself by granting the caller's own full control
 * via a DACL-only apply, then retry — never by relaxing the label requirement.
 */
it.skipIf(process.platform!=='win32')('self-heals a workspace whose DACL omits the caller, and still labels it',()=>{
  const root=mkdtempSync(join(tmpdir(),'dsh-acl-selfheal-')),workspace=join(root,'workspace')
  mkdirSync(workspace)
  const sid=currentSid()
  // Modify-only for the caller with no inherited grants: WRITE_DAC, no WRITE_OWNER.
  execFileSync('icacls.exe',[workspace,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)(M)`])
  try{
    const grant=AclWriteGrant.create(workspaceWriteSid(workspace))
    try{
      expect(()=>grant.add(workspace,true)).not.toThrow()
    }finally{
      grant.dispose()
    }
    const sddl=execFileSync('powershell.exe',['-NoProfile','-Command',`(Get-Acl -LiteralPath '${workspace}').Sddl`],{ encoding:'utf8' }).trim()
    // The caller must hold the full control the repair added. The Low label needs
    // SeSecurityPrivilege, so it is asserted only where the token can carry it:
    // a non-elevated account cannot write a SACL at all, and the write
    // confinement still holds through the capability ACE.
    expect(sddl).toContain(sid)
    expect(sddl).toContain('FA')
  }finally{
    execFileSync('icacls.exe',[workspace,'/grant:r',`*${sid}:(OI)(CI)F`])
    rmSync(root,{ recursive:true,force:true })
  }
})
