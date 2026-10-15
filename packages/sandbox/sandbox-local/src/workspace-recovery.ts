/** Single-attempt Windows workspace grant recovery; never relaxes confinement. */
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'

/** Evidence supplied before an approved repair; no command argv is executed here. */
export interface WorkspaceGrantFailure {
  policy: SandboxPolicy
  cause: Error
  signal?: AbortSignal
}

/** Retry provisioning once only after a repair owner reports verified success.
 * @param provision - original confinement preparation, not the command body.
 * @param failure - exact per-call policy and cancellation.
 * @param repair - returns true only after explicit approval and verified repair.
 * @returns the original provider's confined result.
 */
export async function recoverWorkspaceGrant<T>(provision: () => T, failure: Omit<WorkspaceGrantFailure, 'cause'>,
  repair: (request: WorkspaceGrantFailure) => Promise<boolean>): Promise<T> {
  try { return provision() } catch (error) {
    if (!(error instanceof Error) || !('api' in error) || error.api !== 'SetNamedSecurityInfoW'
      || !('win32Code' in error) || error.win32Code !== 5 || failure.policy.mode !== 'workspace-write'
      || !error.message.includes(`grantWrite(${failure.policy.workspaceRoot})`)) throw error
    failure.signal?.throwIfAborted()
    const repaired = await repair({ ...failure, cause: error })
    failure.signal?.throwIfAborted()
    if (!repaired) throw new SandboxUnavailableError(failure.policy.mode,
      `Workspace permission preparation failed at ${failure.policy.workspaceRoot}. Repair was not authorized or verified. Use diagnose-windows-sandbox-acl; no command was started. Original failure: ${error.message}`)
    try { return provision() } catch (retryError) {
      throw new SandboxUnavailableError(failure.policy.mode,
        `Workspace permission repair completed but sandbox verification failed at ${failure.policy.workspaceRoot}; no command was started. ${String(retryError)}`)
    }
  }
}
