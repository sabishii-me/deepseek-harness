/** Load the backend through a real Cordis configuration; mock only the native process/policy provider. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import JouzuBackend from '../src/index.ts'

it('loads from cordis configuration and refuses runner failure before native process creation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jouzu-loader-'))
  let ctx: Context | undefined
  let spawned = 0
  const received: string[] = []
  const provider = {
    apply(context: Context) {
      context.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) })
      context.provide('sandbox', { confine: async () => { throw new Error('runner unavailable') } })
      context.provide('subprocess', { spawn: () => {
        spawned++
        received.push('unexpected spawn')
        throw new Error('Native process must not start')
      } })
    },
  }
  try {
    const config = join(root, 'cordis.yml')
    await writeFile(config, JSON.stringify([
      { name: 'test-native-execution' },
      { name: '@deepseek-ai/dsh-experimental-jouzu-backend', config: { argv: ['jouzu'] } },
    ]))
    ctx = await boot('jouzu-loader-test', config, [], (host) => {
      const modules = new Map<string, unknown>([['test-native-execution', provider], ['@deepseek-ai/dsh-experimental-jouzu-backend', JouzuBackend]])
      const loader: ModuleLoaderV2 = {
        version: 'v2', loadCache: new Map(),
        async import(specifier) {
          if (!modules.has(specifier)) throw new Error(`Unexpected fixture import ${specifier}`)
          return modules.get(specifier)
        },
        register(): never { throw new Error('Unexpected hook registration') },
        getOrCreateModuleJob(): never { throw new Error('Unexpected module job') },
        resolveSync(): never { throw new Error('Unexpected resolution') },
        load(): never { throw new Error('Unexpected module load') },
      }
      host.loader.internal = loader
    })
    const id = SessionId('loader-policy-test')
    const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false, cwd: root })
    await expect(ctx.jouzuBackend.open({
      session, cwd: root,
      // A confined session always routes tools through the bridge, so the run
      // reaches the sandbox before any native process is created.
      toolBridge: async () => ({ url: 'http://127.0.0.1:12345', token: 'test-capability', dispose: async () => {} }),
    }, { event: () => {}, failure: () => {} })).rejects.toThrow('runner unavailable')
    expect(spawned).toBe(0)
    expect(received).toEqual([])
  } finally {
    await ctx?.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
