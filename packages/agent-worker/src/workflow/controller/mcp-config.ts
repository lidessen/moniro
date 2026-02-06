/**
 * Workflow MCP Config Generation
 * Generates MCP configuration for workflow HTTP transport.
 *
 * Extracted to its own module to avoid circular dependencies between
 * backends/ and workflow/controller/.
 */

/** MCP config format for workflow context */
export interface WorkflowMCPConfig {
  mcpServers: Record<string, unknown>
}

/**
 * Generate MCP config for workflow context server.
 *
 * Uses HTTP transport — CLI agents connect directly via URL:
 *   { type: "http", url: "http://127.0.0.1:<port>/mcp?agent=<name>" }
 */
export function generateWorkflowMCPConfig(
  mcpUrl: string,
  agentName: string
): WorkflowMCPConfig {
  const url = `${mcpUrl}?agent=${encodeURIComponent(agentName)}`
  return {
    mcpServers: {
      'workflow-context': {
        type: 'http',
        url,
      },
    },
  }
}
