/** Native execution admission through the existing DSH file-policy seam. */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-sandbox'
import type { SandboxExecutionPolicy, SandboxEnforcement } from '@deepseek-ai/dsh-sandbox'
import { JouzuError } from './error.ts'

/** Resolve file-effect authority; no implicit authorization for unconfined foreign execution.
 * @param ctx - host service context.
 * @param session - exact Session whose durable policy applies.
 * @returns resolved DSH policy, or an actionable refusal.
 */
export function executionPolicy(ctx: Context, session: Session): SandboxExecutionPolicy {
  const service = ctx.get('sandboxPolicy')
  if (!service) throw new JouzuError('POLICY', 'Jouzu requires DSH sandboxPolicy; refusing ungoverned native execution')
  return service.resolve({ session })
}

/** Authority ordering of the file-effect modes; a higher rank permits strictly more. */
function rank(mode: SandboxExecutionPolicy['mode']): number {
  return mode === 'read-only' ? 0 : mode === 'workspace-write' ? 1 : 2
}

/** Apply the resolved DSH policy without introducing a second permission regime.
 * @param ctx - host services.
 * @param session - Session owning the process.
 * @param argv - complete native command without shell interpretation.
 * @param signal - startup cancellation tied to plugin lifetime.
 * @returns confined argv plus a policy guard for later native commands.
 */
export async function confineJouzu(ctx: Context, session: Session, argv: readonly string[], signal: AbortSignal): Promise<{ argv: string[]; mode: SandboxExecutionPolicy['mode']; enforcement: SandboxEnforcement | 'unconfined'; assertPolicy(): void }> {
  signal.throwIfAborted()
  const policy = executionPolicy(ctx, session)
  let command = [...argv]
  let enforcement: SandboxEnforcement | 'unconfined' = 'unconfined'
  if (policy.mode !== 'danger-full-access') {
    const sandbox = ctx.get('sandbox')
    if (!sandbox) throw new JouzuError('POLICY', 'Jouzu requires a DSH sandbox provider for this restricted policy; refusing bare argv')
    const wrapped = await sandbox.confine(argv, { ...policy, mode: policy.mode }, signal)
    signal.throwIfAborted()
    command = wrapped.argv
    enforcement = wrapped.enforcement
  }
  const assertPolicy = (): void => {
    const current = executionPolicy(ctx, session)
    // The confined process was launched under the policy captured at startup.
    // Widening afterwards (read-only -> workspace-write -> danger-full-access, or a
    // workspace root that now contains the old one) leaves the process holding LESS
    // authority than it could have, which is harmless. Tightening is what cannot be
    // honoured: the running process was already granted the wider reach, so it must
    // be stopped rather than silently continuing under a policy it no longer satisfies.
    if (current.sessionId !== policy.sessionId) {
      throw new JouzuError('POLICY', 'DSH policy belongs to a different Session; stop this native process before reopening')
    }
    if (rank(current.mode) < rank(policy.mode)) {
      throw new JouzuError('POLICY', `DSH file policy narrowed from ${policy.mode} to ${current.mode} while Jouzu was running; stop this native process before reopening under the narrower policy`)
    }
    if (current.mode === 'workspace-write' && policy.mode === 'workspace-write' && current.workspaceRoot !== policy.workspaceRoot) {
      throw new JouzuError('POLICY', `DSH workspace root changed from ${policy.workspaceRoot} to ${current.workspaceRoot} while Jouzu was running; stop this native process before reopening under the new root`)
    }
  }
  assertPolicy()
  return { argv: command, mode: policy.mode, enforcement, assertPolicy }
}
