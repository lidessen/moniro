/**
 * Integration with Vercel's bash-tool for file system operations
 *
 * Provides bash, readFile, writeFile tools for AI agents in a sandboxed environment
 */

import { createBashTool, type CreateBashToolOptions, type BashToolkit } from 'bash-tool'
import type { ToolDefinition } from '../types.ts'

export type { CreateBashToolOptions, BashToolkit }
export { createBashTool }

/**
 * Options for creating bash tools compatible with AgentSession
 */
export interface BashToolsOptions extends CreateBashToolOptions {
  /**
   * Include readFile tool (default: true)
   */
  includeReadFile?: boolean
  /**
   * Include writeFile tool (default: true)
   */
  includeWriteFile?: boolean
}

/**
 * Create bash tools as ToolDefinition array for use with AgentSession
 *
 * @example
 * ```typescript
 * const bashTools = await createBashTools({
 *   files: { 'src/index.ts': 'console.log("hello")' }
 * })
 *
 * const session = new AgentSession({
 *   model: 'anthropic/claude-sonnet-4-5',
 *   system: 'You are a coding assistant.',
 *   tools: bashTools
 * })
 * ```
 */
export async function createBashTools(
  options: BashToolsOptions = {}
): Promise<{ tools: ToolDefinition[]; toolkit: BashToolkit }> {
  const { includeReadFile = true, includeWriteFile = true, ...bashOptions } = options

  const toolkit = await createBashTool(bashOptions)

  const tools: ToolDefinition[] = []

  // Convert bash tool
  tools.push({
    name: 'bash',
    description: 'Execute bash commands in a sandboxed environment. Returns stdout, stderr, and exit code.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute',
        },
      },
      required: ['command'],
    },
    execute: async (args) => {
      const bashTool = toolkit.tools.bash
      if (!bashTool?.execute) {
        throw new Error('Bash tool not available')
      }
      const result = await bashTool.execute(args as { command: string }, {} as never)
      return result
    },
  })

  // Convert readFile tool
  if (includeReadFile) {
    tools.push({
      name: 'readFile',
      description: 'Read the contents of a file from the sandbox filesystem.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to read',
          },
        },
        required: ['path'],
      },
      execute: async (args) => {
        const readFileTool = toolkit.tools.readFile
        if (!readFileTool?.execute) {
          throw new Error('ReadFile tool not available')
        }
        const result = await readFileTool.execute(args as { path: string }, {} as never)
        return result
      },
    })
  }

  // Convert writeFile tool
  if (includeWriteFile) {
    tools.push({
      name: 'writeFile',
      description: 'Write content to a file in the sandbox filesystem. Creates parent directories if needed.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to write',
          },
          content: {
            type: 'string',
            description: 'The content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
      execute: async (args) => {
        const writeFileTool = toolkit.tools.writeFile
        if (!writeFileTool?.execute) {
          throw new Error('WriteFile tool not available')
        }
        const result = await writeFileTool.execute(
          args as { path: string; content: string },
          {} as never
        )
        return result
      },
    })
  }

  return { tools, toolkit }
}

/**
 * Quick helper to create bash tools with a directory
 *
 * @example
 * ```typescript
 * const { tools } = await createBashToolsFromDirectory('./src')
 * ```
 */
export async function createBashToolsFromDirectory(
  source: string,
  options: Omit<BashToolsOptions, 'uploadDirectory'> = {}
): Promise<{ tools: ToolDefinition[]; toolkit: BashToolkit }> {
  return createBashTools({
    ...options,
    uploadDirectory: { source },
  })
}

/**
 * Quick helper to create bash tools with inline files
 *
 * @example
 * ```typescript
 * const { tools } = await createBashToolsFromFiles({
 *   'index.ts': 'console.log("hello")',
 *   'package.json': '{"name": "test"}'
 * })
 * ```
 */
export async function createBashToolsFromFiles(
  files: Record<string, string>,
  options: Omit<BashToolsOptions, 'files'> = {}
): Promise<{ tools: ToolDefinition[]; toolkit: BashToolkit }> {
  return createBashTools({
    ...options,
    files,
  })
}
