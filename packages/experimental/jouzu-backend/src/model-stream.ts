/** Incremental DSH stream translation into the Pi transport's OpenAI SSE deltas. */
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { isDeepStrictEqual } from 'node:util'

/** Compare complete JSON values when an adapter canonicalizes the final block. */
function equivalentArguments(streamed: string, final: string): boolean {
  try { return isDeepStrictEqual(JSON.parse(streamed), JSON.parse(final)) }
  catch (error) {
    // Incomplete or invalid streamed JSON cannot certify equivalent arguments.
    if (error instanceof SyntaxError) return false
    throw error
  }
}

/** Per-request translation; tool indexes are separate from content block indexes. */
export class ModelStreamEncoder {
  private readonly text = new Map<number, string>()
  private readonly tools = new Map<number, { index: number; args: string; id: string; name?: string }>()
  /** Translate one chunk without waiting for the next or buffering the entire response.
   * @param chunk - public DSH stream event.
   * @returns wire deltas; usage/finish are handled by the transport owner.
   */
  push(chunk: StreamChunk): object[] {
    if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      this.text.set(chunk.index, (this.text.get(chunk.index) ?? '') + chunk.text)
      return [chunk.type === 'text-delta' ? { content: chunk.text } : { reasoning_content: chunk.text }]
    }
    if (chunk.type === 'tool-call-delta') {
      let tool = this.tools.get(chunk.index)
      if (!tool) { tool = { index: this.tools.size, args: '', id: chunk.id }; this.tools.set(chunk.index, tool) }
      if (tool.id !== chunk.id) throw new Error('Tool identity changed during streaming')
      tool.args += chunk.argumentsDelta
      const name = chunk.name !== undefined && tool.name !== chunk.name ? chunk.name : undefined
      if (tool.name !== undefined && name !== undefined) throw new Error('Tool name changed during streaming')
      if (name !== undefined) tool.name = name
      return [{ tool_calls: [{ index: tool.index, id: tool.id, type: 'function', function: { ...(name === undefined ? {} : { name }), arguments: chunk.argumentsDelta } }] }]
    }
    if (chunk.type === 'block-end') {
      const block = chunk.block
      if (block.type === 'text' || block.type === 'reasoning') {
        const sent = this.text.get(chunk.index) ?? ''
        if (!block.text.startsWith(sent)) throw new Error('Model rewrote streamed text')
        const suffix = block.text.slice(sent.length)
        return suffix ? [block.type === 'text' ? { content: suffix } : { reasoning_content: suffix }] : []
      }
      if (block.type === 'tool-call') {
        const tool = this.tools.get(chunk.index)
        if (tool && (tool.id !== block.id || (tool.name !== undefined && tool.name !== block.name))) throw new Error('Model rewrote streamed tool call')
        if (tool && !block.arguments.startsWith(tool.args)) {
          if (!equivalentArguments(tool.args, block.arguments)) throw new Error('Model rewrote streamed tool call')
          // Complete equivalent JSON is already on the wire; canonicalization adds no bytes.
          if (tool.name === undefined) {
            tool.name = block.name
            return [{ tool_calls: [{ index: tool.index, function: { name: block.name } }] }]
          }
          return []
        }
        const index = tool?.index ?? this.tools.size
        if (!tool) this.tools.set(chunk.index, { index, args: block.arguments, id: block.id, name: block.name })
        return [{ tool_calls: [{ index, id: block.id, type: 'function', function: { ...(tool?.name === undefined ? { name: block.name } : {}), arguments: block.arguments.slice(tool?.args.length ?? 0) } }] }]
      }
      throw new Error('Unsupported model output modality')
    }
    return []
  }
}
