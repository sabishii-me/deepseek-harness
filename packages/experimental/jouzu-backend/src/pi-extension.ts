/** Public Pi extension source; deliberately imports neither DSH's nor Jouzu's Pi internals. */
export const bridgeExtension = `export default function(pi) {
  const model = JSON.parse(process.env.DSH_BRIDGE_MODEL);
  pi.registerProvider('dsh-bridge', {
    baseUrl: process.env.DSH_BRIDGE_URL,
    apiKey: '$DSH_BRIDGE_TOKEN',
    api: 'openai-completions',
    models: [{ id: 'selected', name: 'DSH selected model', reasoning: false,
      input: ['text'], contextWindow: model.contextWindow, maxTokens: model.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }]
  })
}
`
