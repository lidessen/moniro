/**
 * Workflow MCP Config Generation & Writing
 *
 * Two responsibilities:
 * 1. Generate MCP config for workflow HTTP transport
 * 2. Write backend-specific MCP config files to workspace
 *
 * Writing lives here (not in backends) because it's workspace infrastructure,
 * not a backend concern. Backends only need their cwd set — they don't
 * need to know about MCP config file layout.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as yamlStringify } from "yaml";

/** MCP config format for workflow context */
export interface WorkflowMCPConfig {
  mcpServers: Record<string, unknown>;
}

/**
 * Generate MCP config for workflow context server.
 *
 * Uses HTTP transport — CLI agents connect directly via URL:
 *   { type: "http", url: "http://127.0.0.1:<port>/mcp?agent=<name>" }
 */
export function generateWorkflowMCPConfig(mcpUrl: string, agentName: string): WorkflowMCPConfig {
  const url = `${mcpUrl}?agent=${encodeURIComponent(agentName)}`;
  return {
    mcpServers: {
      "workflow-context": {
        type: "http",
        url,
      },
    },
  };
}

/**
 * Write MCP config to a workspace directory in the format expected by a backend.
 *
 * Each CLI backend reads MCP config from a different location:
 * - claude:   {workspace}/mcp-config.json        (passed via --mcp-config flag)
 * - cursor:   {workspace}/.cursor/mcp.json       (auto-discovered by cursor)
 * - codex:    {workspace}/.codex/config.yaml      (auto-discovered by codex)
 * - opencode: {workspace}/opencode.json           (auto-discovered by opencode)
 * - default/mock: no config file needed (MCP handled by loop via SDK)
 */
export function writeBackendMcpConfig(
  backendType: string,
  workspaceDir: string,
  mcpConfig: WorkflowMCPConfig,
): void {
  // Ensure workspace directory exists (factory usually creates it,
  // but callers like tests may skip that step)
  ensureDir(workspaceDir);

  switch (backendType) {
    case "claude":
      writeJsonConfig(join(workspaceDir, "mcp-config.json"), mcpConfig);
      break;

    case "cursor": {
      const cursorDir = join(workspaceDir, ".cursor");
      ensureDir(cursorDir);
      writeJsonConfig(join(cursorDir, "mcp.json"), mcpConfig);
      break;
    }

    case "codex": {
      const codexDir = join(workspaceDir, ".codex");
      ensureDir(codexDir);
      // Codex uses mcp_servers (snake_case) in YAML
      const codexConfig = { mcp_servers: mcpConfig.mcpServers };
      writeFileSync(join(codexDir, "config.yaml"), yamlStringify(codexConfig));
      break;
    }

    case "opencode": {
      // OpenCode uses { mcp: { name: { type: "local", ... } } } format
      const opencodeMcp: Record<string, unknown> = {};
      for (const [name, config] of Object.entries(mcpConfig.mcpServers)) {
        const serverConfig = config as {
          command?: string;
          args?: string[];
          env?: Record<string, string>;
          type?: string;
          url?: string;
        };
        // HTTP transport: pass through directly
        if (serverConfig.type === "http") {
          opencodeMcp[name] = serverConfig;
        } else {
          opencodeMcp[name] = {
            type: "local",
            command: [serverConfig.command, ...(serverConfig.args || [])],
            enabled: true,
            ...(serverConfig.env ? { environment: serverConfig.env } : {}),
          };
        }
      }
      const opencodeConfig = {
        $schema: "https://opencode.ai/config.json",
        mcp: opencodeMcp,
      };
      writeJsonConfig(join(workspaceDir, "opencode.json"), opencodeConfig);
      break;
    }

    // default, mock: no config file needed
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeJsonConfig(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
}
