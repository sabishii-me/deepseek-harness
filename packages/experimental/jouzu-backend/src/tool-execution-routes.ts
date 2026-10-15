/** Explicit execution ownership for a future tool-confined Jouzu process. */
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'

/** Resolve native tool ownership without changing a running process's permissions.
 * @param mode - effective DSH Session policy.
 * @returns native-to-DSH routes and native execution paths requiring interception.
 */
export function toolExecutionRoutes(mode: SandboxMode) {
  if (mode === 'danger-full-access') return { restricted: false, routes: {}, intercept: [] } as const
  return {
    restricted: true,
    routes: { powershell: 'pwsh', read: 'read', write: 'write', edit: 'edit' },
    // These are not silently removed capabilities: each needs an execution adapter
    // before a tool-confined harness can be enabled in production.
    intercept: ['bash', 'bg_task', 'bg_status', 'subagent', 'user_bash'],
  } as const
}

/** Translate native arguments without forwarding unsupported escalation keys.
 * @param name - native tool name being replaced.
 * @param args - native parsed arguments.
 * @returns public DSH tool arguments, or throws for an unimplemented mapping.
 */
export function translateNativeToolArguments(name: string, args: Record<string, unknown>): Record<string, unknown> {
  switch (name) {
    case 'powershell': {
      if (typeof args.command !== 'string') throw new Error('PowerShell command must be a string')
      if (args.timeout !== undefined && (typeof args.timeout !== 'number' || !Number.isFinite(args.timeout) || args.timeout <= 0)) throw new Error('PowerShell timeout must be positive seconds')
      return { command: args.command, description: 'Jouzu PowerShell execution', ...(args.timeout === undefined ? {} : { timeoutMs: Number(args.timeout) * 1000 }) }
    }
    case 'write': {
      if (typeof args.path !== 'string' || typeof args.content !== 'string') throw new Error('Write requires path and content')
      return { file_path: args.path, content: args.content }
    }
    default: throw new Error(`Native tool argument mapping is not implemented: ${name}`)
  }
}
