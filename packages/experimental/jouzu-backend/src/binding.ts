import { pluginRecordOf } from '@deepseek-ai/dsh-session'
/** Required native identity: never silently replace a missing Jouzu conversation. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
export interface JouzuBinding { sessionId: string; sessionFile: string }
const schema = z.object({ sessionId: z.string().min(1), sessionFile: z.string().min(1) })
declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Native Jouzu session id and file bound to this DSH Session before its first prompt. */
    'plugin:jouzu-backend/binding': JouzuBinding
  }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { jouzuBinding: JouzuBinding | null }
  interface SessionProjectionMap { jouzuBinding: JouzuBinding | null }
}
/** Native session identity shared by all reattachments of this DSH Session. */
export const bindingProjection = {
  key: 'jouzuBinding', stateVersion: 1, stateSchema: schema.nullable(),
  init: (): JouzuBinding | null => null,
  wire: { viewSchema: schema.nullable(), view: (state: JouzuBinding | null) => state },
  apply(state, event) {
    const record = pluginRecordOf(event)
    if (record?.type !== 'plugin:jouzu-backend/binding') return state
    const value = schema.parse(record.data)
    if (state && (state.sessionId !== value.sessionId || state.sessionFile !== value.sessionFile)) throw new Error('Jouzu native identity cannot change')
    return value
  },
} satisfies ProjectionDefinition<'jouzuBinding', JouzuBinding | null>
