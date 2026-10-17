// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { registerAccountUi } from '../src/client/account.tsx'
import type { ShisaStatus } from '@deepseek-ai/dsh-experimental-shisa-provider/types'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function fixture(desktop: boolean, ready = false) {
  if (desktop) vi.stubGlobal('dshDesktop', {})
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: {
    'settings.onboarding': { kind: 'list', scope: 'root' },
    'settings.models.sign-in': { kind: 'single', scope: 'root' },
    'settings.models.provider-card': { kind: 'keyed', scope: 'root' },
  } } as never, () => null)
  let state = { phase: ready ? 'ready' : 'signed-out', modelCount: 0 } as ShisaStatus
  const actions = {
    read: async () => state,
    signIn: async () => { state = { phase: 'waiting', modelCount: 0, url: 'https://example.test/authorize', code: 'TEST-CODE' } as ShisaStatus },
    cancel: async () => { state = { phase: 'signed-out', modelCount: 0 } as ShisaStatus },
    signOut: async () => {}, refresh: async () => {},
  }
  registerAccountUi(ctx, actions)
  const complete = vi.fn()
  const openSection = vi.fn()
  const entry = slots.entries('settings.onboarding').find(e => e.options.id === 'shisa')
  return { ctx, slots, actions, complete, openSection, entry }
}

it('registers a desktop onboarding step and renders authorization in that step, not a settings redirect', async () => {
  const f = await fixture(true)
  try {
    expect(f.entry).toBeDefined()
    render(createElement(f.entry!.component as unknown as ComponentType<Record<string, unknown>>, { ...f.actions, t: (key: string) => key, complete: f.complete, openSection: f.openSection, stepId: 'shisa' }))
    fireEvent.click(await screen.findByRole('button', { name: 'signIn' }))
    expect((await screen.findByRole('link', { name: 'open' })).getAttribute('href')).toBe('https://example.test/authorize')
    expect(screen.getByText('TEST-CODE')).toBeTruthy()
    expect(f.openSection).not.toHaveBeenCalled()
    expect(f.complete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('later', { selector: 'button' }))
    await waitFor(() => expect(f.complete).toHaveBeenCalledTimes(1))
    expect((await f.actions.read()).phase).toBe('signed-out')
  } finally { await f.ctx.fiber.dispose() }
})

it('does not prompt an already connected user', async () => {
  const f = await fixture(true, true)
  try {
    render(createElement(f.entry!.component as unknown as ComponentType<Record<string, unknown>>, { ...f.actions, t: (key: string) => key, complete: f.complete, openSection: f.openSection, stepId: 'shisa' }))
    await waitFor(() => expect(f.complete).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'signIn' })).toBeNull()
  } finally { await f.ctx.fiber.dispose() }
})

it('keeps web sign-in in the existing slot without a duplicate onboarding step', async () => {
  const f = await fixture(false)
  try {
    expect(f.entry).toBeUndefined()
    expect(f.slots.entries('settings.models.sign-in')).toHaveLength(1)
    expect(f.slots.entries('settings.models.provider-card')).toHaveLength(1)
  } finally { await f.ctx.fiber.dispose() }
})
