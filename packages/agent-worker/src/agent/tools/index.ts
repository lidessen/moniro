/**
 * Agent tools
 *
 * This directory contains tool implementations that agents can use.
 * Each tool produces AI SDK tool() objects as Record<name, tool()>.
 *
 * Tool infrastructure (createTool, createSkillsTool) comes from @moniro/agent.
 * Concrete tool implementations (bash, feedback) come from @moniro/workflow.
 */

// Tool creation utility + Skills (from @moniro/agent)
export { createTool, createSkillsTool } from "@moniro/agent";

// Bash tools (bash, readFile, writeFile)
export {
  createBashTools,
  createBashToolsFromDirectory,
  createBashToolsFromFiles,
  createBashTool,
} from "@moniro/workflow";
export type { BashToolsOptions, BashToolkit, CreateBashToolOptions } from "@moniro/workflow";

// Feedback tool
export { createFeedbackTool, FEEDBACK_PROMPT } from "@moniro/workflow";
export type { FeedbackEntry, FeedbackToolOptions, FeedbackToolResult } from "@moniro/workflow";
