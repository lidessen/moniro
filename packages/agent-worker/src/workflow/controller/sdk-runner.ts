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
    });
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
 * Used by the controller when backend.type === 'sdk'.
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
    log(`[${ctx.name}] MCP connected, ${Object.keys(mcp.tools).length} context tools`);

    // 2. Create model
    const model = await createModelAsync(ctx.agent.model!);

    // 3. Assemble tools: MCP context + bash
    const tools = { ...mcp.tools, bash: createBashTool() };

    // 4. Build prompt and run
    const prompt = buildAgentPrompt(ctx);
    log(
      `[${ctx.name}] Prompt (${prompt.length} chars) → sdk with ${Object.keys(tools).length} tools`,
    );

    const result = await generateText({
      model,
      tools,
      system: ctx.agent.resolvedSystemPrompt,
      prompt,
      maxOutputTokens: 8192,
      stopWhen: stepCountIs(15),
    });

    log(`[${ctx.name}] Completed: ${result.text?.slice(0, 100) || "(tool calls only)"}`);
    log(
      `[${ctx.name}] Steps: ${result.steps.length}, Tool calls: ${result.steps.reduce((n, s) => n + s.toolCalls.length, 0)}`,
    );

    await mcp.close();
    return { success: true, duration: Date.now() - startTime, content: result.text };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`[${ctx.name}] Error: ${errorMsg}`);
    return { success: false, error: errorMsg, duration: Date.now() - startTime };
  }
}
