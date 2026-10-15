/**
 * The confined tool surface: which tools a Workspace Write session exposes, why
 * the excluded ones cannot be supported, and the guarantees the bridge makes.
 *
 * These assertions encode measured behaviour, not intent. Each exclusion is
 * backed by a process-creation site in the tool's implementation, because a
 * confined process under the write-restricted token cannot create children at
 * all (CreateProcess is denied; verified for node, cmd, pwsh and Git Bash).
 * A feature that reaches a spawn therefore cannot be restored by configuration,
 * so it is excluded deliberately and visibly rather than failing at use.
 */
import { readFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'
import { CONFINED_EXCLUDED_TOOLS, CONFINED_TOOL_ALLOWLIST } from '../src/agent.ts'
import { restrictedToolExtension } from '../src/restricted-extension.ts'

const JOUZU = 'F:/devAI/deepseek-harness/jouzu-user-test/node_modules/jouzu'

/** A host catalog covering the confined allowlist. */
const catalog = {
  tools: [
    { name: 'read', description: 'Read a file', parameters: { type: 'object' } },
    { name: 'write', description: 'Write a file', parameters: { type: 'object' } },
    { name: 'edit', description: 'Edit a file', parameters: { type: 'object' } },
    { name: 'glob', description: 'Find files', parameters: { type: 'object' } },
    { name: 'grep', description: 'Search files', parameters: { type: 'object' } },
    { name: 'pwsh', description: 'Run PowerShell', parameters: { type: 'object' } },
  ],
}

/** Restore every stubbed global after each test. */
const mountCleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of mountCleanups.splice(0)) cleanup() })

/** Run the extension against a stubbed bridge and capture registrations, hooks and posts. */
async function mount(options: { names?: readonly string[]; catalog?: unknown } = {}) {
  const names = options.names ?? CONFINED_TOOL_ALLOWLIST
  const extension = await import(`data:text/javascript;base64,${Buffer.from(restrictedToolExtension(names)).toString('base64')}`)
  const tools: { name: string; execute: (id: string, args: object, signal?: AbortSignal) => Promise<unknown> }[] = []
  const hooks = new Map<string, (...args: unknown[]) => unknown>()
  const posted: { name: string; arguments: unknown }[] = []
  const previousFetch = globalThis.fetch
  const previousUrl = process.env.DSH_TOOL_BRIDGE_URL
  // The extension reads its endpoint from the environment, exactly as it does
  // in a real confined child. The stub stays installed past mount so the
  // registered tools can be executed by the test.
  process.env.DSH_TOOL_BRIDGE_URL = 'http://127.0.0.1:1'
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/tools')) return Response.json(options.catalog ?? catalog)
    posted.push(JSON.parse(String(init?.body)) as { name: string; arguments: unknown })
    return Response.json({ content: [{ type: 'text', text: 'ok' }], isError: false })
  }
  mountCleanups.push(() => {
    globalThis.fetch = previousFetch
    if (previousUrl === undefined) delete process.env.DSH_TOOL_BRIDGE_URL
    else process.env.DSH_TOOL_BRIDGE_URL = previousUrl
  })
  try {
    await extension.default({
      registerTool: (tool: (typeof tools)[number]) => tools.push(tool),
      on: (event: string, handler: (...args: unknown[]) => unknown) => hooks.set(event, handler),
    })
  } catch (error) {
    for (const cleanup of mountCleanups.splice(0)) cleanup()
    throw error
  }
  return { tools, hooks, posted }
}


it('exposes the file and shell surface, and serves the shell under Jouzu’s own bash name', async () => {
  const { tools } = await mount()
  // `pwsh` is the host executor; the model sees `bash` so its mental model is
  // unchanged while the confined route behind the name is the host sandbox.
  expect(tools.map(tool => tool.name).sort()).toEqual(['bash', 'edit', 'glob', 'grep', 'read', 'write'])
})

it('routes every bridged call through the host bridge instead of executing locally', async () => {
  const { tools, posted } = await mount()
  const bash = tools.find(tool => tool.name === 'bash')!
  await bash.execute('call-1', { command: 'git status' })
  // The host tool name is preserved: the bridge maps `bash` back to `pwsh`.
  expect(posted).toEqual([{ callId: 'call-1', name: 'pwsh', arguments: { command: 'git status' } }])
})

it('fails loudly when a host tool the allowlist needs is absent', async () => {
  // A partially registered surface would surface as a mysterious missing tool
  // mid-task, so an absent allowlist member must stop the session at startup.
  const present = { tools: catalog.tools.filter(tool => tool.name !== 'grep') }
  await expect(mount({ catalog: present })).rejects.toThrow('Required DSH tools missing: grep')
})

it('refuses the native shell bypass, so execution cannot escape the bridge', async () => {
  const { hooks } = await mount()
  const result = hooks.get('user_bash')!() as { result: { exitCode: number; output: string } }
  expect(result.result.exitCode).toBe(1)
  expect(result.result.output).toContain('refused')
})

it('excludes exactly the tools whose implementation reaches a process spawn', () => {
  expect([...CONFINED_EXCLUDED_TOOLS]).toEqual(['bg_task', 'subagent'])
})

it('evidences each exclusion with a process-creation site in the implementation', () => {
  const sources: Record<string, string> = {
    // A background task IS a detached child process.
    bg_task: readFileSync(`${JOUZU}/node_modules/@vanillagreen/pi-background-tasks/extensions/background-tasks.ts`, 'utf8'),
    // A subagent is a forked Node worker with an IPC channel.
    subagent: readFileSync(`${JOUZU}/dist/subagents/manager.js`, 'utf8'),
  }
  for (const tool of CONFINED_EXCLUDED_TOOLS) {
    expect(sources[tool], `${tool} source must be readable`).toBeDefined()
    expect(/\b(spawn|fork)\w*\(/.test(sources[tool]!), `${tool} must reach a process creation`).toBe(true)
  }
})

it('keeps the features whose execution path never spawns', () => {
  // `web_fetch` is the fetch entrypoint; the spawns in this package belong to
  // auxiliary paths (gh CLI discovery, browser broker) the fetch path does not use.
  const fetchEntry = readFileSync(`${JOUZU}/node_modules/pi-webaio/dist/src/jouzu-extension.js`, 'utf8')
  expect(/\b(child_process|spawn|fork)\b/.test(fetchEntry)).toBe(false)
  // Task tracking is state plus prompt injection only.
  const tasks = readFileSync(`${JOUZU}/node_modules/@lhl/pi-tasks/src/index.ts`, 'utf8')
  expect(/from ["']node:child_process["']/.test(tasks)).toBe(false)
  // Scheduled prompts run in an in-process AgentSession, so they need no child.
  const scheduled = readFileSync(`${JOUZU}/node_modules/pi-schedule-prompt/dist/subagent.js`, 'utf8')
  expect(scheduled).toContain('createAgentSession')
  expect(scheduled).toContain('SessionManager.inMemory')
  expect(/from ["']node:child_process["']/.test(scheduled)).toBe(false)
})
