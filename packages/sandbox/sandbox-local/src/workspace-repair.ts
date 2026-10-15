/** Explicitly approved, bounded workspace recovery using the shipped ACL repair script. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-subprocess'
import { workspaceRepairScript } from '@deepseek-ai/dsh-sandbox-windows-acl'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceGrantFailure } from './workspace-recovery.ts'

/** Ask once, retain backups, and return true only for a verified recovery report.
 * @param ctx - injected agents, approval and subprocess services.
 * @param request - workspace provisioning failure before any command started.
 * @returns whether the provider may retry confinement preparation once.
 */
export async function repairWorkspaceGrant(ctx: Context, request: WorkspaceGrantFailure): Promise<boolean> {
  const agent = ctx.agents.currentInitiator()
  if (!agent || agent.id !== request.policy.sessionId) return false
  const root = request.policy.workspaceRoot
  const en = `Repair Windows file permissions for ${root} and affected folders inside it? This may add your account's full-control permission and remove conflicting application-package permissions. File contents and owners stay unchanged. Backups and restore commands will be saved under your user profile. The requested command will still run inside the sandbox.`
  const zh = `是否修复 ${root} 及其中受影响目录的 Windows 文件权限？这可能为你的账号补充完全控制权限，并移除冲突的应用包权限。文件内容和所有者不变；备份与恢复命令保存在你的用户目录。原命令仍在沙箱内执行。`
  const outcome = await ctx.approval.request({ agent, toolName: 'sandbox-workspace-repair', reason: en,
    displayReason: { en, zh }, ...(request.signal ? { signal: request.signal } : {}) })
  if (outcome !== 'allowed-once') return false
  request.signal?.throwIfAborted()
  const directory = await mkdtemp(join(tmpdir(), 'dsh-approved-acl-repair-'))
  // The mkdtemp suffix names the recovery run; it is always present.
  const runName = directory.split(/[\\/]/u).at(-1) ?? 'repair'
  const report = join(homedir(), '.dsh-acl-recovery', runName)
  const script = join(directory, 'repair.ps1')
  try {
    await writeFile(script, workspaceRepairScript(), { mode: 0o600, flag: 'wx' })
    // Do not abort a repair subprocess mid-transaction: its rollback must finish.
    // Cancellation is checked after settlement, before retrying confinement.
    const child = ctx.subprocess.spawn({ argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Path', root, '-AllowRoot', root, '-Out', report], cwd: directory,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, graceMs: 1000 })
    let tail = ''
    const collect = (chunk: Buffer) => { tail = (tail + chunk.toString('utf8')).slice(-65536) }
    child.stdout?.on('data', collect); child.stderr?.on('data', collect)
    const result = await child.done
    await child.waitForExit()
    ctx.logger.info('Workspace permission repair reports: %s', report)
    request.signal?.throwIfAborted()
    if (result.exitCode !== 0) throw new Error(`Workspace repair failed; inspect backups and recovery instructions at ${report}. ${tail.slice(-2000)}`)
    const summary = tail.split(/\r?\n/u).filter(line => line.startsWith('REPORT ')).map((line) => {
      try { return JSON.parse(line.slice(7)) as { kind?: string; details?: { nextAction?: string } } } catch { return undefined }
    }).findLast(record => record?.kind === 'summary')
    if (summary?.details?.nextAction !== 'verify_original_confined_operation') throw new Error(`Workspace repair did not certify success; see ${report}`)
    return true
  } finally { await rm(directory, { recursive: true, force: true }) }
}
