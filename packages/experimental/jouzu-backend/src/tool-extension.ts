/** Public Pi extension source for explicit DSH tool aliases; no third-party imports. */
export const toolBridgeExtension = `export default async function(pi) {
  const url = process.env.DSH_TOOL_BRIDGE_URL;
  const headers = { authorization: 'Bearer ' + process.env.DSH_TOOL_BRIDGE_TOKEN, 'content-type': 'application/json' };
  const response = await fetch(url + '/tools', { headers });
  if (!response.ok) throw new Error('DSH tool catalog failed: ' + response.status);
  const { tools } = await response.json();
  for (const tool of tools) {
    pi.registerTool({
      name: 'dsh_' + tool.name,
      label: 'DSH: ' + tool.name,
      description: tool.description,
      parameters: tool.parameters,
      async execute(callId, args, signal) {
        const response = await fetch(url + '/execute', {
          method: 'POST', headers, signal,
          body: JSON.stringify({ callId, name: tool.name, arguments: args })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'DSH tool invocation failed');
        // Deferred DSH context accompanies this tool result so it reaches the next
        // native request without a second asynchronous Flow-controlled submission.
        const context = (result.additionalContexts || []).flatMap(message => message.content);
        return { content: [...result.content, ...context], isError: result.isError,
          ...(result.meta === undefined ? {} : { details: result.meta }),
          ...(result.concludesTurn ? { terminate: true } : {}) };
      }
    });
  }
}
`
