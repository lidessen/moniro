/**
 * Pretty display mode using @clack/prompts
 *
 * Clean, step-based CLI output:
 * - Each message/event is a step
 * - Uses clack's native symbols
 * - Minimal decoration, maximum clarity
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import type { ContextProvider } from "./context/provider.ts";
import type { Message } from "./context/types.ts";

// ==================== Config ====================

export interface PrettyDisplayConfig {
  /** Context provider to poll */
  contextProvider: ContextProvider;
  /** Agent names */
  agentNames: string[];
  /** Workflow name */
  workflowName: string;
  /** Workflow tag (main will be omitted) */
  tag: string;
  /** Workflow file path (optional) */
  workflowPath?: string;
  /** Poll interval in ms (default: 500) */
  pollInterval?: number;
  /** Starting cursor position */
  initialCursor?: number;
}

// ==================== State ====================

interface PrettyDisplayState {
  /** Current spinner */
  spinner: ReturnType<typeof p.spinner> | null;
  /** Workflow phase */
  phase: "init" | "running" | "complete" | "error";
  /** Has shown agents started */
  hasShownAgentsStarted: boolean;
}

// ==================== ASCII Banner ====================

const BANNER = `
 █████╗  ██████╗ ███████╗███╗   ██╗████████╗    ██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗██████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝    ██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝██╔══██╗
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║       ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ █████╗  ██████╔╝
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║       ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ██╔══╝  ██╔══██╗
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║       ╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████╗██║  ██║
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝        ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
`;

// ==================== Agent Colors ====================

const AGENT_COLORS = [pc.cyan, pc.yellow, pc.magenta, pc.green, pc.blue];

function getAgentColor(name: string, agentNames: string[]): (s: string) => string {
  if (name === "system" || name === "user") return pc.dim;
  const idx = agentNames.indexOf(name);
  if (idx < 0) {
    const hash = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return AGENT_COLORS[hash % AGENT_COLORS.length]!;
  }
  return AGENT_COLORS[idx % AGENT_COLORS.length]!;
}

// ==================== Message Processing ====================

/**
 * Process a channel entry for pretty display
 */
function processEntry(entry: Message, state: PrettyDisplayState, agentNames: string[]): void {
  const { kind, from, content } = entry;

  // Skip debug entries
  if (kind === "debug") return;

  // Log entries (operational messages)
  if (kind === "log") {
    if (content.includes("Running workflow:")) {
      state.phase = "running";
      return; // Skip - workflow name already shown in intro
    }

    if (content.includes("Agents:")) {
      return; // Skip - agents already shown in Initialized step
    }

    if (content.includes("Starting agents")) {
      if (state.spinner) {
        // Show agent names when stopping init spinner
        const agentList = agentNames.join(", ");
        state.spinner.stop(`Initialized: ${pc.dim(agentList)}`);
      }
      state.spinner = p.spinner();
      state.spinner.start("Starting agents");
    } else if (content.includes("Workflow complete")) {
      if (state.spinner) {
        state.spinner.stop("Complete");
        state.spinner = null;
      }
      const match = content.match(/\(([0-9.]+)s\)/);
      if (match) {
        p.log.success(`Completed in ${match[1]}s`);
      }
      state.phase = "complete";
    } else if (content.startsWith("CALL ")) {
      // Tool calls - show as step with caller info
      const toolCall = content.replace("CALL ", "");
      // Extract agent name from "workflow:agentName" format
      const caller = from.includes(":") ? from.split(":")[1] : from;
      const color = getAgentColor(caller!, agentNames);
      p.log.step(`${color(caller!)} ${pc.dim(toolCall)}`);
    } else if (content.startsWith("[ERROR]")) {
      p.log.error(content.replace("[ERROR] ", ""));
      state.phase = "error";
    } else if (content.startsWith("[WARN]")) {
      p.log.warn(content.replace("[WARN] ", ""));
    }
    return;
  }

  // Agent messages (kind=undefined)
  const color = getAgentColor(from, agentNames);

  // Stop spinner when first agent message arrives
  if (state.spinner && state.phase === "running" && !state.hasShownAgentsStarted) {
    state.spinner.stop("Agents started");
    state.spinner = null;
    state.hasShownAgentsStarted = true;
  }

  // Show message in a note box
  p.note(content, color(from));
}

// ==================== Pretty Display Watcher ====================

export interface PrettyDisplayWatcher {
  stop: () => void;
}

/**
 * Start pretty display watcher
 */
export function startPrettyDisplay(config: PrettyDisplayConfig): PrettyDisplayWatcher {
  const {
    contextProvider,
    agentNames,
    workflowName,
    tag,
    workflowPath,
    pollInterval = 500,
    initialCursor = 0,
  } = config;

  const state: PrettyDisplayState = {
    spinner: null,
    phase: "init",
    hasShownAgentsStarted: false,
  };

  // Show ASCII banner
  console.log(pc.cyan(BANNER));

  // Build intro text with workflow, tag, and path
  const tagText = tag === "main" ? "" : `:${tag}`;
  const pathText = workflowPath ? ` ${pc.dim(`(${workflowPath})`)}` : "";
  const introText = ` ${workflowName}${tagText}${pathText} `;

  // Show intro
  p.intro(pc.bgCyan(pc.black(introText)));

  // Add blank line after intro
  console.log("");

  // Start initial spinner with agent count
  state.spinner = p.spinner();
  const agentCount = agentNames.length;
  const agentWord = agentCount === 1 ? "agent" : "agents";
  state.spinner.start(`Initializing ${agentCount} ${agentWord}`);

  let cursor = initialCursor;
  let running = true;

  const poll = async () => {
    while (running) {
      try {
        const tail = await contextProvider.tailChannel(cursor);
        for (const entry of tail.entries) {
          processEntry(entry, state, agentNames);
        }
        cursor = tail.cursor;
      } catch {
        // Ignore errors during polling
      }
      await sleep(pollInterval);
    }
  };

  poll();

  return {
    stop: () => {
      running = false;
      if (state.spinner) {
        state.spinner.stop("Stopped");
      }
    },
  };
}

/**
 * Show workflow completion summary
 */
export function showWorkflowSummary(options: {
  duration: number;
  document?: string;
  feedback?: Array<{ type: string; target: string; description: string }>;
}): void {
  const { document, feedback } = options;

  // Show document if present
  if (document && document.trim()) {
    p.note(document, "Document");
  }

  // Show feedback if present
  if (feedback && feedback.length > 0) {
    const feedbackLines = feedback.map((f) => `[${f.type}] ${f.target}: ${f.description}`);
    p.note(feedbackLines.join("\n"), `Feedback (${feedback.length})`);
  }

  p.outro("Done");
}

// ==================== Helpers ====================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
