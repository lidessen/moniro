/**
 * SDK Agent Runner
 *
 * Runs SDK agents with full tool access in workflows:
 * - MCP context tools (channel_send, document_write, etc.)
 * - Bash tool for shell commands
 *
 * Same pattern as mock-runner.ts but with real models via createModelAsync.
 * This is the standard execution path for SDK backends in workflows —
 * all agents get MCP + bash regardless of backend type.
 */

import { generateText, tool, stepCountIs, jsonSchema } from "ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { execSync } from "node:child_process";
import { createModelAsync } from "@/agent/models.ts";
import type { AgentRunContext, AgentRunResult } from "./types.ts";
import { buildAgentPrompt } from "./prompt.ts";

// ==================== Debug Formatting ====================

/** Extract useful details from AI SDK errors (statusCode, url, responseBody) */
function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const e = error as unknown as Record<string, unknown>;
  const parts: string[] = [error.message];
  if (e.statusCode) parts[0] = `HTTP ${e.statusCode}: ${error.message}`;
  if (e.url) parts.push(`url=${e.url}`);
  if (e.responseBody && typeof e.responseBody === "string") {
    const body = e.responseBody.length > 200 ? e.responseBody.slice(0, 200) + "…" : e.responseBody;
    parts.push(`body=${body}`);
  }
  return parts.join(" ");
}

/** Truncate string, flatten newlines */
function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

/** Format a tool call for concise single-line debug output (function call syntax) */
function formatToolCall(tc: { toolName: string } & Record<string, unknown>): string {
  const input = (tc.input ?? tc.args ?? {}) as Record<string, unknown>;
  const pairs = Object.entries(input).map(([k, v]) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `${k}=${truncate(s, 60)}`;
  });
  // Use function call syntax: bash(command="ls") instead of bash command="ls"
  return `${tc.toolName}(${pairs.join(", ")})`;
}

// ==================== MCP Tool Bridge ====================

/**
 * Connect to workflow MCP server and create AI SDK tool wrappers.
 * Same bridge as mock-runner — extracted here for SDK agents.
 */
async function createMCPToolBridge(mcpUrl: string, agentName: string) {
  const url = new URL(`${mcpUrl}?agent=${encodeURIComponent(agentName)}`);
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client({ name: agentName, version: "1.0.0" });
  await client.connect(transport);

  const { tools: mcpTools } = await client.listTools();

  const aiTools: Record<string, ReturnType<typeof tool>> = {};
  for (const mcpTool of mcpTools) {
    const toolName = mcpTool.name;
    aiTools[toolName] = tool({
      description: mcpTool.description || toolName,
      inputSchema: jsonSchema(mcpTool.inputSchema as Parameters<typeof jsonSchema>[0]),
      execute: async (args: Record<string, unknown>) => {
        const result = await client.callTool({ name: toolName, arguments: args });
        return result.content;
      },
    } as unknown as Parameters<typeof tool>[0]);
  }

  return { tools: aiTools, close: () => client.close() };
}

// ==================== Bash Tool ====================

function createBashTool() {
  return tool({
    description: "Execute a shell command and return stdout/stderr.",
    inputSchema: jsonSchema<{ command: string }>({
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
      },
      required: ["command"],
    }),
    execute: async ({ command }: { command: string }) => {
      try {
        return execSync(command, { encoding: "utf-8", timeout: 120_000 }).trim() || "(no output)";
      } catch (error: any) {
        return `Error (exit ${error.status}): ${error.stderr || error.message}`;
      }
    },
  });
}

// ==================== SDK Agent Runner ====================

/**
 * Run an SDK agent with real model + MCP tools + bash.
 *
 * Used by the controller when backend.type === 'default'.
 * Unlike the simple SdkBackend.send() (text-only), this runner:
 * 1. Connects to MCP server for context tools (channel, document)
 * 2. Adds bash tool for shell access
 * 3. Runs generateText with full tool loop
 */
export async function runSdkAgent(
  ctx: AgentRunContext,
  debugLog?: (message: string) => void,
): Promise<AgentRunResult> {
  const startTime = Date.now();
  const log = debugLog || (() => {});

  try {
    if (!ctx.mcpUrl) {
      return { success: false, error: "SDK runner requires mcpUrl", duration: 0 };
    }

    // 1. Connect MCP for context tools
    const mcp = await createMCPToolBridge(ctx.mcpUrl, ctx.name);
    log(`MCP connected, ${Object.keys(mcp.tools).length} context tools`);

    // 2. Create model
    const model = await createModelAsync(ctx.agent.model!);

    // 3. Assemble tools: MCP context + bash
    const tools = { ...mcp.tools, bash: createBashTool() };

    // 4. Build prompt and run
    const prompt = buildAgentPrompt(ctx);
    log(`Prompt (${prompt.length} chars) → sdk with ${Object.keys(tools).length} tools`);

    let _stepNum = 0;
    const result = await generateText({
      model,
      tools,
      system: ctx.agent.resolvedSystemPrompt,
      prompt,
      maxOutputTokens: ctx.agent.max_tokens ?? 8192,
      // Use user's max_steps if set, otherwise allow up to 200 steps (effectively no limit for most tasks)
      stopWhen: stepCountIs(ctx.agent.max_steps ?? 200),
      onStepFinish: (step) => {
        _stepNum++;
        if (step.toolCalls?.length) {
          for (const tc of step.toolCalls) {
            // Only log non-MCP tools (like bash) - MCP tools are logged by MCP server
            if (tc.toolName === "bash") {
              const args = formatToolCall(tc);
              // Write bash tool call directly to channel with tool_call type (fire-and-forget)
              ctx.provider
                .appendChannel(ctx.name, args, {
                  kind: "tool_call",
                  toolCall: { name: tc.toolName, args },
                })
                .catch(() => {});
            }
          }
        }
      },
    });

    const totalToolCalls = result.steps.reduce((n, s) => n + s.toolCalls.length, 0);
    const lastStep = result.steps[result.steps.length - 1];

    // Warn if max_steps limit was reached while agent was still working
    if (
      ctx.agent.max_steps &&
      result.steps.length >= ctx.agent.max_steps &&
      (lastStep?.toolCalls?.length ?? 0) > 0
    ) {
      const warning = `⚠️  Agent reached max_steps limit (${ctx.agent.max_steps}) but wanted to continue. Consider increasing max_steps or removing the limit.`;
      log(warning);
      // Also write to channel so user can see it
      await ctx.provider.appendChannel(ctx.name, warning, { kind: "log" }).catch(() => {});
    }

    await mcp.close();
    return {
      success: true,
      duration: Date.now() - startTime,
      content: result.text,
      steps: result.steps.length,
      toolCalls: totalToolCalls,
    };
  } catch (error) {
    const errorMsg = formatError(error);
    return { success: false, error: errorMsg, duration: Date.now() - startTime };
  }
}
