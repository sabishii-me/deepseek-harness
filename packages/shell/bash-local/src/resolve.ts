/**
 * Bash executable resolution shared by the local executor and its tests.
 *
 * The implementation avoids process-global command probes: deterministic
 * install roots and PATH entries are ordinary filesystem inputs, so an app
 * execution alias or legacy WSL shim cannot silently outrank Git Bash.
 *
 * @module @deepseek-ai/dsh-bash-local/resolve
 */

import { lstatSync } from 'node:fs'
import { join, normalize } from 'node:path'

/** Whether a candidate names a spawnable file or Windows app-execution alias. */
function candidateExists(candidate: string): boolean {
  try {
    const stat = lstatSync(candidate)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Git for Windows and PATH candidates, in deterministic preference order.
 * The Git `bin` launcher is preferred over `usr/bin`: both reach the same
 * runtime, while `bin` is Git for Windows' documented Bash entry point.
 * @param env - environment whose install roots and PATH are inspected.
 * @returns absolute or PATH-derived candidate filenames.
 */
export function candidateBashPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const value = (name: string): string | undefined => {
    const entry = Object.entries(env).find(([key]) => key.toUpperCase() === name.toUpperCase())
    return entry?.[1]
  }
  const candidates: string[] = []
  const programFiles = [value('ProgramFiles'), value('ProgramFiles(x86)')]
  for (const root of programFiles) {
    if (root === undefined || root.length === 0) continue
    candidates.push(join(root, 'Git', 'bin', 'bash.exe'))
    candidates.push(join(root, 'Git', 'usr', 'bin', 'bash.exe'))
  }
  for (const entry of (value('PATH') ?? '').split(';')) {
    const trimmed = entry.trim().replace(/^"|"$/g, '')
    if (trimmed.length > 0) candidates.push(join(trimmed, 'bash.exe'))
  }
  return [...new Set(candidates.map(candidate => normalize(candidate)))]
}

/**
 * Resolve the Bash executable used for every command.
 * @param configured - explicit executable path or command, trusted as-is.
 * @param env - environment to inspect on Windows.
 * @param platform - host platform.
 * @returns Git Bash or another PATH candidate on Windows, otherwise `bash`.
 * @throws when Windows has no usable Bash installation.
 */
export function resolveBashPath(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (configured !== undefined && configured.length > 0) return configured
  if (platform !== 'win32') return 'bash'
  for (const candidate of candidateBashPaths(env)) {
    if (candidateExists(candidate)) return candidate
  }
  throw new Error(
    'bash-local: no Windows Bash executable found; install Git for Windows or configure shell.bashPath',
  )
}
