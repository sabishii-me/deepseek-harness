/** Resolve packaged Windows recovery assets without assuming node_modules layout. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Read the bundled recovery script for extraction by an approved repair runner.
 * @returns exact shipped PowerShell source; the caller owns its private extracted copy.
 */
export function workspaceRepairScript(): string {
  return readFileSync(fileURLToPath(new URL('../assets/diagnose-windows-sandbox-acl/scripts/diagnose-windows-sandbox-acl.ps1', import.meta.url)), 'utf8')
}
