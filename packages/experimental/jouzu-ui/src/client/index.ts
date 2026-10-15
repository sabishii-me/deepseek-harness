import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
/** Optional Session dock; no alternate conversation or task scheduler. */
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { JouzuTool } from './Tool.tsx'
import { JouzuPanel } from './Panel.tsx'
import { en, zh } from './locales.ts'

/** Services supplying existing Session UI slots and locale-owned chrome. */
export const inject = ['slots', 'locale']
/** Install the optional projection-only Jouzu dock.
 * @param ctx - browser plugin lifetime.
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of ['TaskCreateMany', 'TaskCreate', 'TaskUpdate', 'TaskList', 'bg_task', 'agent_wait']) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key, locale: 'jouzu' }, JouzuTool)
    }
  })
  ctx.effect(() => ctx.locale.register('jouzu', { en, zh }))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'jouzu', order: 20, locale: 'jouzu',
  }, JouzuPanel))
}
