/** Compose the published pi-ai plugin without importing its internal helpers. */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, ReasoningEffortId, type GenerateOptions, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'

/** A generation owns an immutable catalog and its official adapter's effects. */
export interface ModelGeneration {
  adapter: LlmAdapter
  dispose(): Promise<void>
}

/** Build one isolated official adapter generation; no Host exports are added.
 * @param owner - lifetime owner and source of DSH credentials/attachments.
 * @param profile - validated-by-pi-ai Shisa model configuration.
 * @returns adapter and its generation disposer.
 */
export async function createModelGeneration(owner: Context, profile: PiAi.PiAiProviderProfile, defaults: ReadonlyMap<string, string> = new Map()): Promise<ModelGeneration> {
  let adapter: LlmAdapter | undefined
  // Registration is the public provider/consumer seam. Observe our own service
  // implementation, not an existing service's private adapter map.
  class ShisaModels extends LlmRuntime {
    override registerAdapter(providers: string[], candidate: LlmAdapter) {
      const handle = super.registerAdapter(providers, candidate)
      adapter = candidate
      return handle
    }
  }
  const fiber = owner.plugin(async (ctx) => {
    const isolated = ctx.isolate('llm').isolate('authorization')
    await isolated.plugin(ShisaModels)
    await isolated.plugin(PiAi, { providers: { shisa: profile } })
  })
  try {
    await fiber
    if (!adapter) throw new Error('Official pi-ai did not register the Shisa adapter')
    const underlying = adapter
    const metadata = (info: LlmResolvedModelInfo): LlmResolvedModelInfo => {
      const effort = defaults.get(info.id)
      return effort && info.reasoning ? { ...info, reasoning: { ...info.reasoning, defaultEffort: ReasoningEffortId(effort) } } : info
    }
    class CatalogAdapter extends LlmAdapter {
      override providerInfo(provider: string) { return underlying.providerInfo(provider) }
      override providerRetryPolicy(provider: string) { return underlying.providerRetryPolicy(provider) }
      override imageRequestPricing(provider: string, model: string) { return underlying.imageRequestPricing(provider, model) }
      override listModels(provider: string) { return underlying.listModels(provider) }
      override async resolveModel(provider: string, model: string, signal?: AbortSignal) { return metadata(await underlying.resolveModel(provider, model, signal)) }
      override async prepareCall(provider: string, model: string, signal?: AbortSignal) {
        const prepared = await underlying.prepareCall(provider, model, signal)
        return { model: metadata(prepared.model), stream: prepared.stream }
      }
      override stream(options: GenerateOptions) { return underlying.stream(options) }
    }
    return { adapter: new CatalogAdapter(), dispose: async () => { await fiber.dispose() } }
  } catch (error) {
    await fiber.dispose()
    throw error
  }
}
