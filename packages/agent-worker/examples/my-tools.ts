/**
 * Example tools file for agent-worker CLI
 *
 * Usage:
 *   agent-worker new test -m openai/gpt-4o --tool ./examples/my-tools.ts
 *   agent-worker send test "What's the weather in Tokyo?"
 */

import { tool, jsonSchema } from "ai";

const tools = {
  get_weather: tool({
    description: "Get current weather for a location",
    parameters: jsonSchema({
      type: "object",
      properties: {
        location: { type: "string", description: "City name" },
        unit: { type: "string", enum: ["celsius", "fahrenheit"] },
      },
      required: ["location"],
    }),
    execute: async (args: Record<string, unknown>) => {
      const location = args.location as string;
      const unit = (args.unit as string) || "celsius";
      // Mock implementation
      return {
        location,
        temperature: unit === "celsius" ? 22 : 72,
        unit,
        condition: "sunny",
      };
    },
  }),

  search_web: tool({
    description: "Search the web for information",
    parameters: jsonSchema({
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Max results to return" },
      },
      required: ["query"],
    }),
    execute: async (args: Record<string, unknown>) => {
      const query = args.query as string;
      const maxResults = (args.maxResults as number) || 5;
      // Mock implementation
      return {
        query,
        results: [
          { title: `Result 1 for "${query}"`, url: "https://example.com/1" },
          { title: `Result 2 for "${query}"`, url: "https://example.com/2" },
        ].slice(0, maxResults),
      };
    },
  }),

  file_operation: tool({
    description: "Perform file operations (read, write, delete)",
    parameters: jsonSchema({
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "write", "delete"] },
        path: { type: "string", description: "File path" },
        content: { type: "string", description: "Content for write operation" },
      },
      required: ["action", "path"],
    }),
    execute: async (args: Record<string, unknown>) => {
      const action = args.action as string;
      const path = args.path as string;
      const content = args.content as string | undefined;
      // Mock implementation
      switch (action) {
        case "read":
          return { content: `Contents of ${path}` };
        case "write":
          return { success: true, path, bytesWritten: content?.length ?? 0 };
        case "delete":
          return { success: true, deleted: path };
        default:
          return { error: `Unknown action: ${action}` };
      }
    },
  }),
};

// Note: For file_operation, configure approval separately in your session:
//   approval: { file_operation: (args) => args.action === 'delete' }

export default tools;
