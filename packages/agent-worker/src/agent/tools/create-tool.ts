/**
 * Type-safe wrapper for AI SDK tool() with JSON Schema.
 *
 * The AI SDK's tool() function has complex generic types that don't align
 * with jsonSchema() return types. This utility absorbs the necessary casts
 * in one place instead of scattering `as unknown` across every tool file.
 */

import { tool, jsonSchema } from "ai";

type JsonSchemaInput = Parameters<typeof jsonSchema>[0];

/**
 * Create an AI SDK tool with a plain JSON Schema object.
 *
 * Usage:
 * ```ts
 * const myTool = createTool({
 *   description: "Do something",
 *   schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
 *   execute: async (args) => { ... },
 * });
 * ```
 */
export function createTool(config: {
  description: string;
  schema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}): ReturnType<typeof tool> {
  return tool({
    description: config.description,
    inputSchema: jsonSchema(
      config.schema as JsonSchemaInput,
    ) as unknown as Parameters<typeof tool>[0]["inputSchema"],
    execute: config.execute,
  } as unknown as Parameters<typeof tool>[0]);
}
