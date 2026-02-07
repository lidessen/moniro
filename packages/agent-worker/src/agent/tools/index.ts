/**
 * Agent tools
 *
 * This directory contains tool implementations that agents can use.
 * Each tool produces AI SDK tool() objects as Record<name, tool()>.
 *
 * Available tools:
 * - Skills: Access and read agent skills
 * - Bash: Execute bash commands in sandboxed environment (includes readFile, writeFile)
 *
 * Future tools:
 * - Git: Git operations
 * - TodoWrite: Manage todos
 */

// Skills tool
export { createSkillsTool } from './skills.ts'

// Bash tools (bash, readFile, writeFile)
export {
  createBashTools,
  createBashToolsFromDirectory,
  createBashToolsFromFiles,
  createBashTool,
} from './bash.ts'
export type { BashToolsOptions, BashToolkit, CreateBashToolOptions } from './bash.ts'
