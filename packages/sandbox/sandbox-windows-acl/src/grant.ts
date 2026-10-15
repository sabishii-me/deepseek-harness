/**
 * Server-side write-grant materialization. The sandbox seam holds one
 * standing workspace grant per workspace and one revocable temp grant per
 * live session/workspace pair. Workspace identities survive by deterministic
 * derivation and their standing ACE; temp identities derive from random
 * private paths and are deliberately new after a restart.
 *
 * Fail-closed: `add` throws on any grant failure and the caller disposes the
 * instance (revoking every path granted so far); `dispose` revokes every
 * revocable grant, leaves the standing workspace edits in place, and reports
 * every cleanup failure.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/grant
 */

import { grantOwnerFullControl, grantWrite, revokeWrite } from './acl.ts'
import { allocPtrSlot, decodePtr, isNullPtr, throwLastError, win32Sync } from './ffi.ts'
import type { NativePtr, Win32Bindings } from './ffi.ts'
import { enableSecurityPrivilege, findCurrentUserSid, makeWellKnownSid, openCurrentProcessToken } from './token.ts'
import * as abi from './win32-abi.ts'

/**
 * One write SID's provider-lifetime grant materialization: the parsed SID
 * pointer plus every directory whose DACL currently carries its ACE and whose
 * label ACL carries the Low mandatory label. Workspace paths are added
 * STANDING (their security descriptor edits are the cross-session reuse cache
 * and outlive the grant — dispose() skips revoking them, or the next
 * provision would re-propagate the whole tree); temp paths are revocable
 * (dispose() revokes them — an inheritable ACE must not outlive its
 * session's temp directory). Create with {@link AclWriteGrant.create};
 * dispose revokes the revocable paths and frees every SID.
 */
export class AclWriteGrant {
  /** The write SID in SDDL string form. */
  readonly writeSid: string
  private readonly api: Win32Bindings
  private readonly sidPtr: NativePtr
  private readonly lowLabelSidPtr: NativePtr
  private readonly worldSidPtr: NativePtr
  private readonly revocablePaths: string[] = []
  private readonly standingPaths: string[] = []
  /** Lazily copied caller user SID (see {@link repairOwnerAccess}); freed by dispose. */
  private ownerSidPtr: NativePtr | undefined
  /** Whether SeSecurityPrivilege was already attempted on the process token. */
  private labelPrivilegeChecked = false

  private constructor(
    api: Win32Bindings,
    sidPtr: NativePtr,
    lowLabelSidPtr: NativePtr,
    worldSidPtr: NativePtr,
    writeSid: string,
  ) {
    this.api = api
    this.sidPtr = sidPtr
    this.lowLabelSidPtr = lowLabelSidPtr
    this.worldSidPtr = worldSidPtr
    this.writeSid = writeSid
  }

  /**
   * Parse the SID string, create the Low integrity SID the grants label with
   * and the world SID their ambient-delete deny names, and open the binding
   * table (lazily, once per server). Fail-closed: any failure throws — nothing
   * is granted yet.
   * @param writeSid - the workspace (`S-1-4-x-y`) or temp (`S-1-4-x-y-1`) capability SID string.
   * @param api - optional already-resolved bindings (tests).
   * @returns the ready grant (no ACEs yet).
   */
  static create(writeSid: string, api?: Win32Bindings): AclWriteGrant {
    const bindings = api ?? win32Sync()
    const sidSlot = allocPtrSlot()
    if (bindings.convertStringSidToSidW(writeSid, sidSlot) === 0) {
      throwLastError(bindings, 'ConvertStringSidToSidW', writeSid)
    }
    const sidPtr = decodePtr(sidSlot)
    if (sidPtr === null) throwLastError(bindings, 'ConvertStringSidToSidW', `null SID for ${writeSid}`)
    try {
      const lowLabelSidPtr = makeWellKnownSid(bindings, abi.WinLowLabelSid)
      try {
        const worldSidPtr = makeWellKnownSid(bindings, abi.WinWorldSid)
        return new AclWriteGrant(bindings, sidPtr, lowLabelSidPtr, worldSidPtr, writeSid)
      } catch (error) {
        // The Low label SID is LocalAlloc'd: release it before the world-SID
        // failure propagates to the sidPtr release below.
        bindings.localFree(lowLabelSidPtr)
        throw error
      }
    } catch (error) {
      bindings.localFree(sidPtr)
      throw error
    }
  }

  /**
   * Grant the write ACE, the ambient-delete deny, and the Low mandatory label
   * on one directory (idempotent: an already-standing exact ACE, deny, and
   * label skip the eager full-tree re-propagation — see {@link grantWrite})
   * and record the path for {@link dispose} unless it is standing. The path is
   * recorded BEFORE the grant: a post-apply throw (a LocalFree failure after
   * SetNamedSecurityInfoW succeeded) must still revoke it, and revoking an
   * ungranted path is a no-op merge. Callers treat a throw as a failed
   * materialization and dispose the instance to revoke the paths granted so
   * far.
   * @param path - the directory whose DACL and label gain the grant.
   * @param standing - the edits outlive this grant (the workspace reuse
   *   cache; dispose() skips revoking it). Default false (revoked on
   *   dispose — the temp-directory lifecycle).
   */
  add(path: string, standing = false): void {
    this.ensureLabelPrivilege()
    ;(standing ? this.standingPaths : this.revocablePaths).push(path)
    grantWrite(this.api, path, this.sidPtr, this.lowLabelSidPtr, this.worldSidPtr, this.repairOwnerAccess)
  }

  /**
   * Grant the CALLER's own SID full control on one directory (DACL only).
   * Called at most once per `add` when the label write was denied because the
   * directory's DACL omits the caller: holding WRITE_DAC is enough for this
   * edit, and it restores the owner-implicit WRITE_OWNER the label needs. The
   * caller SID is read lazily so a healthy workspace never opens its token.
   */
  private readonly repairOwnerAccess = (path: string): void => {
    this.ownerSidPtr ??= this.resolveOwnerSid()
    grantOwnerFullControl(this.api, path, this.ownerSidPtr)
  }

  /** Open this process's token once, copy its user SID, and close the handle.
   * @returns the copied caller user SID owned by this grant.
   */
  private resolveOwnerSid(): NativePtr {
    const token = openCurrentProcessToken(this.api)
    try {
      return findCurrentUserSid(this.api, token)
    } finally {
      if (this.api.closeHandle(token) === 0) throwLastError(this.api, 'CloseHandle', 'current process token')
    }
  }

  /** Enable SeSecurityPrivilege for the process token, so the Low label can be
   * written. Called once, before the first grant that needs a label; an
   * administrator token holds the privilege disabled and this enables it, while
   * a non-elevated token simply reports the privilege as unavailable
   * (the grant path then proceeds without the label, and confinement still
   * rests on the token and capability ACE).
   */
  private ensureLabelPrivilege(): void {
    if (this.labelPrivilegeChecked) return
    this.labelPrivilegeChecked = true
    const token = openCurrentProcessToken(this.api)
    try {
      enableSecurityPrivilege(this.api, token)
    } finally {
      if (this.api.closeHandle(token) === 0) throwLastError(this.api, 'CloseHandle', 'current process token')
    }
  }

  /** Every directory currently carrying the grant, in grant order. */
  get paths(): readonly string[] {
    return [...this.standingPaths, ...this.revocablePaths]
  }

  /** Revoke every revocable grant (standing security descriptor edits stay) and free the SIDs; reports every cleanup failure. */
  dispose(): void {
    const failures: unknown[] = []
    for (const path of this.revocablePaths) {
      try {
        revokeWrite(this.api, path, this.sidPtr)
      } catch (error) {
        failures.push(error)
      }
    }
    for (const [label, sidPtr] of [
      ['write SID', this.sidPtr],
      ['Low label SID', this.lowLabelSidPtr],
      ['world SID', this.worldSidPtr],
      ...this.ownerSidPtr === undefined ? [] : [['caller user SID', this.ownerSidPtr] as const],
    ] as const) {
      try {
        const freed = this.api.localFree(sidPtr)
        if (!isNullPtr(freed)) throwLastError(this.api, 'LocalFree', label)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `AclWriteGrant dispose completed with ${failures.length} cleanup failure(s)`)
    }
  }
}
