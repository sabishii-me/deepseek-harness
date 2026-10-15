/** Shisa device authorization settings, using the authenticated Host Remote namespace. */
import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import shisaRemote from '@deepseek-ai/dsh-experimental-shisa-provider/remote'
import type {} from '@deepseek-ai/dsh-experimental-shisa-provider/remote'
import { Button, StateDot, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ShisaStatus } from '@deepseek-ai/dsh-experimental-shisa-provider/types'
import css from './account.module.css'

const en = { modelName: 'Model name', details: 'Model details', modelId: 'Model ID', baseURL: 'Base URL', catalogURL: 'Catalog URL', catalogConfig: 'Model catalog', context: 'Context window', output: 'Maximum output tokens', managed: 'Using the Shisa catalog', copy: 'Copy authorization link', copied: 'Link copied', manual: 'Open this link in any browser, or copy it to another browser or device. Keep this page open while approving.', opening: 'Requesting authorization link…', popup: 'If no tab opened, use the link below.', onboarding: 'Connect a model to get started', apiKey: 'Use a DeepSeek API key', later: 'Configure later', title: 'Shisa', signIn: 'Sign in with Shisa', signOut: 'Sign out', cancel: 'Cancel sign-in', open: 'Open authorization page', code: 'Verification code', waiting: 'Waiting for browser approval', ready: 'Connected', disconnected: 'Not connected', description: 'Use Shisa models in DSH. Browser authorization uses the Jouzu client identity.', models: 'Available models', refresh: 'Refresh models' } as const
const zh: Record<keyof typeof en, string> = { modelName: '模型名称', details: '模型参数', modelId: '模型 ID', baseURL: 'API 地址', catalogURL: '目录地址', catalogConfig: '模型目录', context: '上下文窗口', output: '最大输出 token', managed: '使用 Shisa 模型目录', copy: '复制授权链接', copied: '链接已复制', manual: '可在任意浏览器打开此地址，或复制到其他浏览器、设备。授权期间请保持本页打开。', opening: '正在获取授权地址…', popup: '若未打开新标签页，请使用下方链接。', onboarding: '连接模型，开始使用', apiKey: '使用 DeepSeek API key', later: '稍后配置', title: 'Shisa', signIn: '登录 Shisa', signOut: '退出登录', cancel: '取消登录', open: '打开授权页面', code: '验证码', waiting: '等待浏览器授权', ready: '已连接', disconnected: '未连接', description: '在 DSH 中使用 Shisa 模型。浏览器授权使用 Jouzu 客户端身份。', models: '可用模型', refresh: '刷新模型' }
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { shisa: keyof typeof en } }
interface Actions { read: () => Promise<ShisaStatus>; signIn: () => Promise<void>; signOut: () => Promise<void>; cancel: () => Promise<void>; refresh: () => Promise<void> }
function Account({ read, signIn, signOut, cancel, refresh, t, onReady }: Actions & { onReady?: () => void } & PropsLocale<'shisa'>) {
  const [state, setState] = useState<ShisaStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try { const next = await read(); if (!disposed) { setState(next); if (next.phase === 'waiting' || next.catalogPhase === 'loading') timer = setTimeout(() => { void poll() }, 1500) } }
      catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)) }
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer) }
  }, [read, busy])
  useEffect(() => { if (state?.phase === 'ready') onReady?.() }, [state, onReady])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await action(); setState(await read()) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <section className={css.card} aria-label={t('title')}>
    <div className={css.identity}><strong>{t('title')}</strong><span>shisa</span></div>
    <div className={css.accountState}><p>{state?.phase === 'ready' ? t('ready') : state?.phase === 'waiting' ? t('waiting') : t('disconnected')} {state?.organization}</p>{state?.phase === 'ready' && <Button disabled={busy} onClick={() => { void run(signOut) }}>{t('signOut')}</Button>}</div>
    {state?.phase === 'waiting' && <div><StateDot state="ongoing" />
      {state.code && <p>{t('code')}: <code>{state.code}</code></p>}
      {!state.url && <p>{t('opening')}</p>}
      {state.url && <>
        <p>{t('manual')}</p>
        <a href={state.url} target="_blank" rel="noopener noreferrer">{t('open')}</a>
        <input aria-label={t('open')} readOnly value={state.url} onFocus={event => event.currentTarget.select()} style={{ width: '100%' }} />
        <Button onClick={() => { void navigator.clipboard.writeText(state.url!).then(() => setCopied(true), () => setError(t('manual'))) }}>{t(copied ? 'copied' : 'copy')}</Button>
      </>}
    </div>}
    {state?.phase === 'ready' && <details open className={css.catalog}>
      <summary>{t('catalogConfig')}</summary>
      {state.baseURL && <dl className={css.endpoint}><dt>{t('baseURL')}</dt><dd>{state.baseURL}</dd></dl>}
      <div className={css.modelsHead}><span>{t('models')} · {state.modelCount}</span><Button disabled={busy || state.catalogPhase === 'loading'} onClick={() => { void run(refresh) }}>{t('refresh')}</Button></div>
      <p className={css.hint}>{t('managed')} · {state.modelCount}</p>
      <ul className={css.modelList}>{state.models?.map(model => <li key={model.id} className={css.modelRow}>
        <details>
          <summary className={css.modelSummary}>
            <span className={css.modelCell} title={model.id}>{model.id}</span>
            <span className={css.modelCell} title={model.name}>{model.name}</span>
            <span className={css.chevron} aria-label={t('details')}>›</span>
          </summary>
          <dl className={css.modelDetails}>
            <div><dt>{t('modelId')}</dt><dd>{model.id}</dd></div>
            {model.contextWindow !== undefined && <div><dt>{t('context')}</dt><dd>{model.contextWindow.toLocaleString()}</dd></div>}
            {model.maxTokens !== undefined && <div><dt>{t('output')}</dt><dd>{model.maxTokens.toLocaleString()}</dd></div>}
          </dl>
        </details>
      </li>)}</ul>
    </details>}
    {state?.catalogError && <p role="alert">{state.catalogError}</p>}
    {(error || (state?.phase === 'error' && state.message)) && <p role="alert">{error || state?.message}</p>}
    <div className={css.actions}>
      {state?.phase === 'waiting' ? <Button disabled={busy} onClick={() => { void run(cancel) }}>{t('cancel')}</Button>
        : state?.phase !== 'ready' && <Button disabled={busy} variant="primary" onClick={() => { setCopied(false); void run(signIn) }}>{t('signIn')}</Button>}
    </div>
  </section>
}
/** Official single-slot onboarding, sharing the existing account Remote. */
function Onboarding({ complete, useApiKey, ...props }: Actions & PropsLocale<'shisa'> & PropsRuntime<'settings.models.sign-in'>) {
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const leave = async (next: () => void) => {
    setLeaving(true); setError(null)
    try { await props.cancel(); next() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setLeaving(false) }
  }
  return <Modal open closeLabel={props.t('later')} title={props.t('onboarding')} onClose={() => { if (!leaving) void leave(complete) }}>
    <Account {...props} onReady={complete} />
    {error && <p role="alert">{error}</p>}
    <div className={css.actions}>
      <Button disabled={leaving} onClick={() => { void leave(useApiKey) }}>{props.t('apiKey')}</Button>
      <Button disabled={leaving} onClick={() => { void leave(complete) }}>{props.t('later')}</Button>
    </div>
  </Modal>
}
/** Services required by the account settings page. */
export const inject = ['slots', 'locale', 'remote']
/** Mount authenticated Remote contribution and account UI.
 * @param ctx - browser plugin lifetime.
 */
export function apply(ctx: Context): void {
  ctx.remote.$mount(shisaRemote)
  ctx.effect(() => ctx.locale.register('shisa', { en, zh }))
  ctx.inject(['remote.shisa'], (scope) => {
    const read = async () => { const result = await scope.remote.shisa.getState(); if (!result.ok) throw new Error(result.error.message); return result.value }
    const actions: Actions = { read,
      refresh: async () => { const r = await scope.remote.shisa.refreshModels(); if (!r.ok) throw new Error(r.error.message) },
      signIn: async () => { const r = await scope.remote.shisa.signIn(); if (!r.ok) throw new Error(r.error.message) },
      signOut: async () => { const r = await scope.remote.shisa.signOut(); if (!r.ok) throw new Error(r.error.message) },
      cancel: async () => { const r = await scope.remote.shisa.cancel(); if (!r.ok) throw new Error(r.error.message) },
    }
    scope.slots.inject('settings.models.sign-in', () => scope.slots.register({ name: 'settings.models.sign-in', locale: 'shisa', inject: () => actions }, Onboarding))
    scope.slots.inject('settings.models.provider-card', () => scope.slots.register({ name: 'settings.models.provider-card', key: 'shisa-provider', locale: 'shisa', inject: () => actions }, Account))
  })
}
