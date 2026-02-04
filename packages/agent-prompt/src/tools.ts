import { tool, jsonSchema } from 'ai'
import type { ToolDefinition } from './types.ts'

/**
 * Convert ToolDefinition array to AI SDK tools object
 * Uses tool() with jsonSchema() for runtime-defined mock tools
 */
export function createTools(definitions: ToolDefinition[]) {
  const tools: Record<string, ReturnType<typeof tool>> = {}

  for (const def of definitions) {
    const schema = jsonSchema<Record<string, unknown>>(def.parameters)

    // Use type assertion to handle the generic inference issue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools[def.name] = tool({
      description: def.description,
      inputSchema: schema,
      execute: async (input) => {
        if (def.execute) {
          return def.execute(input as Record<string, unknown>)
        }
        return { error: 'No mock implementation provided' }
      },
    }) as any
  }

  return tools
}
