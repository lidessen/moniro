import { dynamicTool, jsonSchema } from 'ai'
import type { ToolDefinition } from './types.ts'

/**
 * Convert ToolDefinition array to AI SDK tools object
 * Uses dynamicTool for runtime-defined tools with mock implementations
 */
export function createTools(
  definitions: ToolDefinition[]
): Record<string, ReturnType<typeof dynamicTool>> {
  const tools: Record<string, ReturnType<typeof dynamicTool>> = {}

  for (const def of definitions) {
    const schema = jsonSchema<Record<string, unknown>>(def.parameters)

    tools[def.name] = dynamicTool({
      description: def.description,
      inputSchema: schema,
      execute: async (input) => {
        if (def.execute) {
          return def.execute(input as Record<string, unknown>)
        }
        return { error: 'No mock implementation provided' }
      },
    })
  }

  return tools
}
