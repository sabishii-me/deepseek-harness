/**
 * Build the Pi extension a confined Jouzu session runs with.
 *
 * A confined process cannot create children: the write-restricted token denies
 * CreateProcess, so Jouzu's own shell tools fail with EPERM regardless of which
 * shell settings resolve to (verified for Git Bash, cmd, pwsh and plain node).
 * This extension therefore replaces process execution with a bridge call: Jouzu
 * asks DSH over HTTP, and DSH runs the command in the sandbox from outside the
 * restricted process — the only shape that both executes and stays confined.
 *
 * The allowlist is the read/write/search/execute surface. Everything else is
 * blocked rather than silently unavailable, and the user_bash hook refuses the
 * native escape hatch so a shell cannot be reached around the bridge.
 * @param names - DSH host tool names this session may call.
 * @returns the Pi extension module source.
 */
export function restrictedToolExtension(names: readonly string[]): string {
  return `export default async function(pi) {
    const headers = { authorization: 'Bearer ' + process.env.DSH_TOOL_BRIDGE_TOKEN, 'content-type': 'application/json' };
    const url = process.env.DSH_TOOL_BRIDGE_URL;
    const catalog = await fetch(url + '/tools', { headers });
    if (!catalog.ok) throw new Error('DSH tool catalog unavailable');
    const { tools } = await catalog.json();
    const wanted = ${JSON.stringify(names)};
    const registered = [];
    for (const tool of tools) {
      if (!wanted.includes(tool.name)) continue;
      // Jouzu's shell tool is called 'bash'; the confined route it must take is
      // the bridge, so the bridged executor is exposed under that same name and
      // no local shell tool is left able to spawn.
      const exposed = tool.name === 'pwsh' ? 'bash' : tool.name;
      pi.registerTool({
        name: exposed, label: tool.name, description: tool.description, parameters: tool.parameters,
        async execute(callId, args, signal) {
          const response = await fetch(url + '/execute', {
            method: 'POST', headers, signal,
            body: JSON.stringify({ callId, name: tool.name, arguments: args }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'DSH tool execution failed');
          return { content: [...result.content, ...(result.additionalContexts || []).flatMap(message => message.content)],
            isError: result.isError, ...(result.meta === undefined ? {} : { details: result.meta }),
            ...(result.concludesTurn ? { terminate: true } : {}) };
        },
      });
      registered.push(exposed);
    }
    const missing = wanted.filter(name => name !== 'pwsh' && !registered.includes(name));
    // A missing read tool would look like a broken session rather than a
    // partially bridged one, so an absent allowlist member is fatal.
    if (missing.length > 0) throw new Error('Required DSH tools missing: ' + missing.join(', '));
    // Every non-bridged Jouzu tool (task tracking, multiloop, webaio, skills)
    // stays native; only execution is redirected. The user_bash hook closes the
    // one remaining way to reach a shell without the bridge.
    pi.on('user_bash', () => ({ result: { output: 'Native shell bypass refused in Workspace Write mode', exitCode: 1, cancelled: false, truncated: false } }));
  }`
}
