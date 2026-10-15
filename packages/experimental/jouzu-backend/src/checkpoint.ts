import { pluginRecordOf } from '@deepseek-ai/dsh-session'
/** Native append-only history checkpoints; mismatch refuses submission rather than replaying input. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { JouzuRecord } from './types.ts'

/** Exact native log fingerprint at an observed settled boundary. */
export interface JouzuCheckpoint {
  readonly digest: string
  readonly leafId: string | null
  readonly entries: number
}
const schema = z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/), leafId: z.string().min(1).nullable(), entries: z.number().int().nonnegative() })
declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Observed native history fingerprint after committed DSH output; guards resubmission after restart. */
    'plugin:jouzu-backend/checkpoint': JouzuCheckpoint
  }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { jouzuCheckpoint: JouzuCheckpoint | null }
}
/** Host-only latest settled native history; not a UI reconstruction source. */
export const checkpointProjection = {
  key: 'jouzuCheckpoint', stateVersion: 1, stateSchema: schema.nullable(),
  init: (): JouzuCheckpoint | null => null,
  apply(state, event) { const record = pluginRecordOf(event); return record?.type === 'plugin:jouzu-backend/checkpoint' ? schema.parse(record.data) : state },
} satisfies ProjectionDefinition<'jouzuCheckpoint', JouzuCheckpoint | null>

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(Reflect.get(value, key))).join(',') + '}'
}

/** Validate a get_entries response and fingerprint all records, including abandoned branches.
 * @param response - native RPC response whose envelope was validated by the transport.
 * @returns checkpoint suitable for exact-match recovery, never a claim of cursor-based reconciliation.
 */
export function nativeCheckpoint(response: JouzuRecord): JouzuCheckpoint {
  const parsed = z.object({ entries: z.array(z.record(z.string(), z.unknown())), leafId: z.string().min(1).nullable() }).parse(response.data)
  const ids = new Set<string>()
  for (const entry of parsed.entries) {
    const id = z.string().min(1).parse(entry.id)
    if (ids.has(id)) throw new Error('Duplicate Jouzu history entry id')
    ids.add(id)
  }
  if (parsed.leafId !== null && !ids.has(parsed.leafId)) throw new Error('Jouzu leaf does not belong to returned history')
  return { digest: createHash('sha256').update(canonical(parsed.entries)).digest('hex'), leafId: parsed.leafId, entries: parsed.entries.length }
}

/** Require exact history continuity before admitting a new native prompt.
 * @param stored - last persisted settled checkpoint.
 * @param current - observed native history after reopening.
 */
export function assertCheckpoint(stored: JouzuCheckpoint | null | undefined, current: JouzuCheckpoint): void {
  if (!stored || stored.digest !== current.digest || stored.leafId !== current.leafId || stored.entries !== current.entries) {
    throw new Error('Jouzu native history differs from the last DSH checkpoint or has no checkpoint; submission refused. Reconcile native history before continuing; do not replay the previous prompt.')
  }
}
