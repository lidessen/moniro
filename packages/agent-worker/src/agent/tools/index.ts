/**
 * Agent tools
 *
 * This directory contains tool implementations that agents can use.
 * Each tool produces AI SDK tool() objects as Record<name, tool()>.
 *
 * Tool creation utility comes from @moniro/agent.
 * Skills come from bash-tool (via @moniro/agent re-export).
 * Concrete tool implementations (bash, feedback) come from @moniro/workflow.
 */

// Tool creation utility (from @moniro/agent)
export { createTool } from "@moniro/agent-loop";

// Skills (from bash-tool, re-exported via @moniro/agent)
export { createSkillTool } from "@moniro/agent-loop";
export type { CreateSkillToolOptions, SkillToolkit } from "@moniro/agent-loop";

// Bash tools (bash, readFile, writeFile)
export {
  createBashTools,
  createBashToolsFromDirectory,
  createBashToolsFromFiles,
  createBashTool,
} from "@moniro/workspace";
export type { BashToolsOptions, BashToolkit, CreateBashToolOptions } from "@moniro/workspace";

// Feedback tool
export { createFeedbackTool, FEEDBACK_PROMPT } from "@moniro/workspace";
export type { FeedbackEntry, FeedbackToolOptions, FeedbackToolResult } from "@moniro/workspace";
