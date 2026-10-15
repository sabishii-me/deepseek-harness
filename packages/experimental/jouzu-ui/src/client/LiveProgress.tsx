/** Live Jouzu feedback over the existing DSH Chat snapshot; no second event stream. */
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatSnapshot, AssistantChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-experimental-jouzu-backend/ui-types'
import { TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'

/** Read only the current running assistant, never reasoning retained from an earlier turn.
 * @param chat - official Chat snapshot, including transient assistant chunks.
 * @returns current reasoning text, or empty while awaiting output or executing tools.
 */
export function liveReasoning(chat: ChatSnapshot | undefined, running = true): string {
  const nodes = (chat?.order ?? []).map(key => chat?.nodes.get(key)).filter(node => node !== undefined)
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]!
    if (node.kind !== 'assistant-step') continue
    const data = node.data as AssistantChatData
    if (running && data.status !== 'running') return ''
    return data.blocks.filter(block => block.kind === 'reasoning').map(block => block.text).join('\n')
  }
  return ''
}

/** Keep actual streaming reasoning visible independently of Chat's disclosure preference. */
export function LiveProgress({ useSession, useProjection, useChat, t }: PropsRuntime<'conversation.input.dock'> & PropsLocale<'jouzu'>) {
  const running = useSession(state => state.running)
  const preset = useProjection('agentPreset')
  const reasoning = useChat(state => liveReasoning(state, running))
  if (preset !== 'jouzu' || (!running && !reasoning)) return null
  return <section aria-label={t('liveProgress')} aria-busy={running}>
    {running ? <div role="status"><TextShimmer>{t(reasoning ? 'liveThinking' : 'liveWorking')}</TextShimmer></div> : <div>{t('thinkingRecorded')}</div>}
    {reasoning && <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '12rem', overflowY: 'auto' }}>{reasoning}</div>}
  </section>
}
