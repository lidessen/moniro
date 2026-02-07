/**
 * Shared run() template for CLI backends
 *
 * All CLI backends (claude, cursor, codex) follow the same pattern:
 * 1. Generate MCP config for the workspace
 * 2. Set up workspace directory
 * 3. Build agent prompt from context
 * 4. Send prompt via CLI and return result
 */

import type { AgentRunContext, AgentRunResult } from '../workflow/controller/types.ts'
import type { BackendResponse } from './types.ts'
import { buildAgentPrompt } from '../workflow/controller/prompt.ts'
import { generateWorkflowMCPConfig } from '../workflow/controller/mcp-config.ts'

/** Minimum interface a CLI backend must satisfy to use runCLIBackend */
export interface CLIRunnable {
  send(message: string, options?: { system?: string }): Promise<BackendResponse>
  setWorkspace(workspaceDir: string, mcpConfig: { mcpServers: Record<string, unknown> }): void
}

/**
 * Shared run() implementation for CLI backends.
 *
 * Sets up workspace with MCP config, builds the agent prompt,
 * sends it via the backend's send() method, and returns the result.
 */
export async function runCLIBackend(
  backend: CLIRunnable,
  ctx: AgentRunContext,
  backendName: string,
  debugLog?: (message: string) => void
): Promise<AgentRunResult> {
  const startTime = Date.now()
  const log = debugLog || (() => {})

  try {
    // Set up workspace with MCP config (HTTP transport)
    const mcpConfig = generateWorkflowMCPConfig(ctx.mcpUrl, ctx.name)
    backend.setWorkspace(ctx.workspaceDir, mcpConfig)

    const prompt = buildAgentPrompt(ctx)

    log(`[${ctx.name}] Sending prompt to ${backendName} backend (${prompt.length} chars)`)
    log(`[${ctx.name}] System prompt: ${(ctx.agent.resolvedSystemPrompt || '(none)').slice(0, 100)}`)
    log(`[${ctx.name}] Workspace: ${ctx.workspaceDir}`)

    const response = await backend.send(prompt, { system: ctx.agent.resolvedSystemPrompt })

    const responsePreview = response.content.length > 200
      ? response.content.slice(0, 200) + '...'
      : response.content
    log(`[${ctx.name}] Response (${response.content.length} chars): ${responsePreview}`)

    return { success: true, duration: Date.now() - startTime }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    log(`[${ctx.name}] Backend error: ${errorMsg}`)
    return {
      success: false,
      error: errorMsg,
      duration: Date.now() - startTime,
    }
  }
}
