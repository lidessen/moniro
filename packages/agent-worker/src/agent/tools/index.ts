/**
 * Agent tools
 *
 * This directory contains tool implementations that agents can use.
 * Each tool produces AI SDK tool() objects as Record<name, tool()>.
 *
 * Available tools:
 * - Skills: Access and read agent skills
 * - Bash: Execute bash commands in sandboxed environment (includes readFile, writeFile)
 * - Feedback: Let agents report observations about tools and workflows
 *
 * Future tools:
 * - Git: Git operations
 * - TodoWrite: Manage todos
 */

// Tool creation utility + Skills (from @moniro/agent)
export { createTool, createSkillsTool } from "@moniro/agent";

// Bash tools (bash, readFile, writeFile)
export {
  createBashTools,
  createBashToolsFromDirectory,
  createBashToolsFromFiles,
  createBashTool,
} from "./bash.ts";
export type { BashToolsOptions, BashToolkit, CreateBashToolOptions } from "./bash.ts";

// Feedback tool
export { createFeedbackTool, FEEDBACK_PROMPT } from "./feedback.ts";
export type { FeedbackEntry, FeedbackToolOptions, FeedbackToolResult } from "./feedback.ts";
