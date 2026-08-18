/** The shipped composition uses Bash on every platform; PowerShell remains an opt-in twin. */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries, initProfile, loadProfile, PROFILES_DIR } from '@deepseek-ai/dsh-app-boot'

function disabled(row: { disabled?: unknown }): boolean {
  return row.disabled === true
}

describe('the shipped shell composition (real bundle layers)', () => {
  let home: string
  afterEach(() => { if (home !== undefined) rmSync(home, { recursive: true, force: true }) })
  const anchor = fileURLToPath(new URL('../package.json', import.meta.url))

  it.each([
    ['web', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']],
    ['base-only', ['@deepseek-ai/dsh-base']],
  ] as const)('profile %s carries the Bash executor and keeps PowerShell disabled', (profileName, bundles) => {
    home = mkdtempSync(join(tmpdir(), 'dsh-windows-home-'))
    initProfile(join(home, PROFILES_DIR, profileName), [...bundles])
    const profile = loadProfile('dsh', profileName, anchor, home)
    const warnings: string[] = []
    const rows = composeEntries(profile.layers.map(layer => layer.patches), message => warnings.push(message))
    const byId = new Map(rows.map(row => [row.id, row]))

    expect(disabled(byId.get('bash-sandbox')!), 'bash-sandbox').toBe(false)
    expect(disabled(byId.get('pwsh-sandbox')!), 'pwsh-sandbox').toBe(true)
    // The web overlay disables host tool rows because presets own them; the
    // base-only composition exposes Bash directly.
    expect(disabled(byId.get('tool-bash')!), 'tool-bash').toBe(profileName === 'web')
    expect(disabled(byId.get('tool-pwsh')!), 'tool-pwsh').toBe(true)
    for (const id of ['sandbox', 'sandbox-policy', 'fs-sandbox', 'approval']) {
      expect(byId.get(id)?.disabled, `row ${id}`).not.toBe(true)
    }
    expect(warnings).toEqual([])
  })
})

describe('shipped agent presets use Bash', () => {
  const presetRoot = resolve(fileURLToPath(new URL('../package.json', import.meta.url)), '..', 'config', 'agent-presets')

  it.each(['standard', 'code', 'cordis'])('preset %s enables Bash and disables PowerShell', (preset) => {
    const entries: unknown = yaml.load(
      readFileSync(join(presetRoot, preset, 'agent.cordis.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(entries)) throw new TypeError(`preset ${preset} must parse to an entry array`)
    const byId = new Map(entries.filter((entry): entry is Record<string, unknown> => (
      typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>).id === 'string'
    )).map(entry => [entry.id, entry]))
    expect(disabled(byId.get('tool-bash')!), 'tool-bash').toBe(false)
    expect(disabled(byId.get('tool-pwsh')!), 'tool-pwsh').toBe(true)
  })

  it('minimal mounts no shell tool row at all (its shell is the PTY stack)', () => {
    const entries: unknown = yaml.load(
      readFileSync(join(presetRoot, 'minimal', 'agent.cordis.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(entries)) throw new TypeError('minimal preset must parse to an entry array')
    for (const id of ['tool-bash', 'tool-pwsh']) {
      expect(entries.some(entry => (
        typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>).id === id
      )), `${id} must be absent from minimal`).toBe(false)
    }
  })
})
