/**
 * Example tools file for agent-worker CLI
 *
 * Usage:
 *   agent-worker session new -m openai/gpt-4o -n test
 *   agent-worker tool import ./examples/my-tools.ts --to test
 *   agent-worker send "What's the weather in Tokyo?" --to test
 */

// Note: In a real project, import from 'agent-worker' after installing the package
// For development, we use relative imports
import type { ToolDefinition } from '../src/types.ts'

const tools: ToolDefinition[] = [
  {
    name: 'get_weather',
    description: 'Get current weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' },
        unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
      },
      required: ['location'],
    },
    execute: async (args) => {
      const location = args.location as string
      const unit = (args.unit as string) || 'celsius'
      // Mock implementation
      return {
        location,
        temperature: unit === 'celsius' ? 22 : 72,
        unit,
        condition: 'sunny',
      }
    },
  },
  {
    name: 'search_web',
    description: 'Search the web for information',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'number', description: 'Max results to return' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const query = args.query as string
      const maxResults = (args.maxResults as number) || 5
      // Mock implementation
      return {
        query,
        results: [
          { title: `Result 1 for "${query}"`, url: 'https://example.com/1' },
          { title: `Result 2 for "${query}"`, url: 'https://example.com/2' },
        ].slice(0, maxResults),
      }
    },
  },
  {
    name: 'file_operation',
    description: 'Perform file operations (read, write, delete)',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'write', 'delete'] },
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Content for write operation' },
      },
      required: ['action', 'path'],
    },
    // Conditional approval: only require approval for delete operations
    needsApproval: (args) => (args.action as string) === 'delete',
    execute: async (args) => {
      const action = args.action as string
      const path = args.path as string
      const content = args.content as string | undefined
      // Mock implementation
      switch (action) {
        case 'read':
          return { content: `Contents of ${path}` }
        case 'write':
          return { success: true, path, bytesWritten: content?.length ?? 0 }
        case 'delete':
          return { success: true, deleted: path }
        default:
          return { error: `Unknown action: ${action}` }
      }
    },
  },
]

export default tools
