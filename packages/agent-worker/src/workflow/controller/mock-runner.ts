/**
 * Mock Agent Runner
 *
 * Orchestrates mock agent execution for workflow integration testing.
 * Uses AI SDK generateText with MockLanguageModelV3 and real MCP tool calls.
 *
 * This lives in the controller layer (not backends) because it does orchestration:
 * connecting to MCP, building prompts, managing tool loops.
 * The mock backend itself is just a simple send() adapter.
 */

import { generateText, tool, stepCountIs, jsonSchema } from "ai";
import { MockLanguageModelV3, mockValues } from "ai/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AgentRunContext, AgentRunResult } from "./types.ts";
import { buildAgentPrompt } from "./prompt.ts";

// ==================== MCP Tool Bridge ====================

interface MCPToolBridge {
  tools: Record<string, ReturnType<typeof tool>>;
  close: () => Promise<void>;
}

/**
 * Connect to workflow MCP server via HTTP and create AI SDK tool wrappers
 */
async function createMCPToolBridge(mcpUrl: string, agentName: string): Promise<MCPToolBridge> {
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

  return {
    tools: aiTools,
    close: () => client.close(),
  };
}

// ==================== Mock Agent Runner ====================

/**
 * Run a mock agent with AI SDK and real MCP tools.
 *
 * Used by the controller when backend.type === 'mock'.
 * Unlike real backends that just send(), the mock runner needs to:
 * 1. Connect to MCP server for real tool execution
 * 2. Generate scripted tool calls via MockLanguageModelV3
 * 3. Execute the full tool loop to test channel/document flow
 */
export async function runMockAgent(
  ctx: AgentRunContext,
  debugLog?: (message: string) => void,
): Promise<AgentRunResult> {
  const startTime = Date.now();
  const log = debugLog || (() => {});

  try {
    if (!ctx.mcpUrl) {
      return {
        success: false,
        error: "Mock runner requires mcpUrl (HTTP MCP server)",
        duration: 0,
      };
    }

    // 1. Connect to MCP
    const mcp = await createMCPToolBridge(ctx.mcpUrl, ctx.name);
    log(`MCP connected, ${Object.keys(mcp.tools).length} tools`);

    // 2. Build scripted mock model
    const inboxSummary = ctx.inbox
      .map((m) => `${m.entry.from}: ${m.entry.content.slice(0, 80).replace(/@/g, "")}`)
      .join("; ");

    const mockModel = new MockLanguageModelV3({
      doGenerate: mockValues(
        {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: `call-${ctx.name}-${Date.now()}`,
              toolName: "channel_send",
              input: JSON.stringify({
                message: `[${ctx.name}] Processed: ${inboxSummary.slice(0, 200)}`,
              }),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: "tool_use" },
          usage: {
            inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 50, text: 50, reasoning: 0 },
          },
        },
        {
          content: [{ type: "text" as const, text: `${ctx.name} done.` }],
          finishReason: { unified: "stop" as const, raw: "end_turn" },
          usage: {
            inputTokens: { total: 50, noCache: 50, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 10, text: 10, reasoning: 0 },
          },
        },
      ) as any,
    });

    // 3. Build prompt and run
    const prompt = buildAgentPrompt(ctx);
    log(`Prompt (${prompt.length} chars)`);

    const result = await generateText({
      model: mockModel,
      tools: mcp.tools,
      prompt,
      system: ctx.agent.resolvedSystemPrompt,
      stopWhen: stepCountIs(3),
      // Tool calls are logged by MCP server with tool_call type
    });

    const totalToolCalls = result.steps.reduce((n, s) => n + s.toolCalls.length, 0);

    await mcp.close();
    return {
      success: true,
      duration: Date.now() - startTime,
      steps: result.steps.length,
      toolCalls: totalToolCalls,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMsg, duration: Date.now() - startTime };
  }
}
