/** Shisa catalog capability projection; absent declarations remain absent. */
import { z } from 'zod'
import type { PiAiModelProfile, PiAiReasoningEfforts, PiAiCompatProfile } from '@deepseek-ai/dsh-llm-pi-ai'
const level = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const compat = z.object({
  supportsDeveloperRole: z.boolean().optional(), supportsReasoningEffort: z.boolean().optional(),
  supportsStore: z.boolean().optional(), supportsUsageInStreaming: z.boolean().optional(),
  maxTokensField: z.enum(['max_tokens', 'max_completion_tokens']).optional(),
  thinkingFormat: z.enum(['openai', 'openrouter', 'deepseek', 'together', 'baseten', 'zai', 'qwen', 'chat-template', 'qwen-chat-template', 'string-thinking', 'ant-ling']).optional(),
})
/** Parse the fields used by the supported official model adapter. */
export const catalogSchema = z.object({
  modelOfferings: z.array(z.object({
    modelId: z.string().min(1), name: z.string().optional(), providerId: z.string().optional(),
    supportedThinkingLevels: z.array(level).nonempty().optional(), defaultThinkingLevel: level.optional(),
    capabilities: z.array(z.string()).optional(), modalities: z.array(z.string()).optional(),
    compatibilityProfileIds: z.array(z.string()).default([]), routeIds: z.array(z.string()).default([]),
    availability: z.object({ status: z.string() }).optional(),
    limits: z.object({ contextWindow: z.number().int().positive().optional(), maxOutputTokens: z.number().int().positive().optional() }).optional(),
  })),
  routes: z.array(z.object({ id: z.string(), compatibilityProfileIds: z.array(z.string()).default([]) })).default([]),
  compatibilityProfiles: z.array(z.object({ id: z.string(), appliesTo: z.string(),
    projections: z.object({ pi: z.object({ compat: compat.optional() }).optional() }).optional(),
  })).default([]),
})
/** Translate catalog declarations without synthesizing levels for unknown models.
 * @param catalog - parsed Shisa catalog.
 * @returns official pi-ai profiles plus per-model defaults.
 */
export function catalogModels(catalog: z.infer<typeof catalogSchema>): { models: PiAiModelProfile[]; defaults: Map<string, z.infer<typeof level>> } {
  const defaults = new Map<string, z.infer<typeof level>>()
  const models = catalog.modelOfferings.filter(item => item.availability?.status !== 'unavailable').map((item) => {
    const ids = [...catalog.routes.filter(route => item.routeIds.includes(route.id)).flatMap(route => route.compatibilityProfileIds), ...item.compatibilityProfileIds]
    const merged: PiAiCompatProfile = {}
    for (const id of ids) {
      const profile = catalog.compatibilityProfiles.find(profile => profile.id === id)
      if (profile?.appliesTo === 'ingress') {
        const values = profile.projections?.pi?.compat
        if (values) Object.assign(merged, Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)))
      }
    }
    let reasoningEfforts: PiAiReasoningEfforts | false | undefined
    if (item.supportedThinkingLevels) {
      reasoningEfforts = item.supportedThinkingLevels.some(value => value !== 'off')
        ? Object.fromEntries(item.supportedThinkingLevels.map(value => [value, value === 'off' ? 'none' : value])) : false
      if (item.defaultThinkingLevel) {
        if (!item.supportedThinkingLevels.includes(item.defaultThinkingLevel)) throw new Error('Catalog thinking default is not offered')
        if (reasoningEfforts !== false) defaults.set(item.modelId, item.defaultThinkingLevel)
      }
    } else if (item.capabilities && !item.capabilities.includes('reasoning')) reasoningEfforts = false
    return { id: item.modelId, name: item.name ?? item.modelId,
      ...(item.limits?.contextWindow === undefined ? {} : { contextWindow: item.limits.contextWindow }),
      ...(item.limits?.maxOutputTokens === undefined ? {} : { maxTokens: item.limits.maxOutputTokens }),
      ...(reasoningEfforts === undefined ? {} : { reasoningEfforts }),
      ...(Object.keys(merged).length ? { compat: merged } : {}),
    }
  })
  return { models, defaults }
}
