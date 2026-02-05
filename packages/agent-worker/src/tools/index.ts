/**
 * Agent tools
 *
 * This directory contains tool implementations that agents can use.
 * Each tool is a function that returns a ToolDefinition.
 *
 * Available tools:
 * - Skills: Access and read agent skills
 *
 * Future tools:
 * - Read: Read files from filesystem
 * - Write: Write files to filesystem
 * - Bash: Execute bash commands
 * - Git: Git operations
 * - TodoWrite: Manage todos
 */

export { createSkillsTool } from './skills.ts'
