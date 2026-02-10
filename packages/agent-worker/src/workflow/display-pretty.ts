/**
 * Pretty display mode using @clack/prompts
 *
 * This provides a clean, interactive CLI experience for non-debug mode:
 * - Spinners for long-running operations
 * - Colored status messages
 * - Grouped agent messages
 * - Summary boxes
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
  /** Poll interval in ms (default: 500) */
  pollInterval?: number;
  /** Starting cursor position */
  initialCursor?: number;
}

// ==================== State ====================

interface PrettyDisplayState {
  /** Current spinner */
  spinner: ReturnType<typeof p.spinner> | null;
  /** Last active agent (for grouping) */
  lastAgent: string | null;
  /** Message buffer for grouping */
  messageBuffer: Array<{ from: string; content: string }>;
  /** Workflow phase */
  phase: "init" | "running" | "complete" | "error";
}

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
    // Extract phase from log content
    if (content.includes("Running workflow:")) {
      state.phase = "running";
      const workflowName = content.split(":")[1]?.trim();
      p.log.info(pc.dim(`Workflow: ${workflowName}`));
    } else if (content.includes("Starting agents")) {
      if (state.spinner) state.spinner.stop("Initialized");
      state.spinner = p.spinner();
      state.spinner.start("Starting agents...");
    } else if (content.includes("Workflow complete")) {
      if (state.spinner) {
        state.spinner.stop(pc.green("✓ Complete"));
        state.spinner = null;
      }
      state.phase = "complete";
    } else if (content.startsWith("CALL ")) {
      // Tool calls - show as info
      const toolCall = content.replace("CALL ", "");
      p.log.step(pc.dim(`  ↳ ${toolCall}`));
    } else if (content.startsWith("[ERROR]")) {
      p.log.error(content.replace("[ERROR] ", ""));
      state.phase = "error";
    } else if (content.startsWith("[WARN]")) {
      p.log.warn(content.replace("[WARN] ", ""));
    }
    return;
  }

  // Agent messages (kind=undefined)
  // Show in grouped format with agent colors
  const color = getAgentColor(from, agentNames);

  // Stop spinner when first agent message arrives
  if (state.spinner && state.phase === "running") {
    state.spinner.stop(pc.green("✓ Agents started"));
    state.spinner = null;
  }

  // If different agent or first message, flush buffer and show new header
  if (state.lastAgent !== from) {
    state.lastAgent = from;
    p.log.message(color(pc.bold(`${from}:`)));
  }

  // Show message content with indent
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.trim()) {
      p.log.message(color(`  ${line}`));
    }
  }
}

// ==================== Pretty Display Watcher ====================

export interface PrettyDisplayWatcher {
  stop: () => void;
}

/**
 * Start pretty display watcher
 */
export function startPrettyDisplay(config: PrettyDisplayConfig): PrettyDisplayWatcher {
  const { contextProvider, agentNames, pollInterval = 500, initialCursor = 0 } = config;

  const state: PrettyDisplayState = {
    spinner: null,
    lastAgent: null,
    messageBuffer: [],
    phase: "init",
  };

  // Show intro
  p.intro(pc.bgCyan(pc.black(" agent-worker ")));

  // Start initial spinner
  state.spinner = p.spinner();
  state.spinner.start("Initializing workflow...");

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
  const { duration, document, feedback } = options;

  // Show duration
  const seconds = (duration / 1000).toFixed(1);
  p.log.success(`Completed in ${seconds}s`);

  // Show document if present
  if (document && document.trim()) {
    p.note(document, "Document");
  }

  // Show feedback if present
  if (feedback && feedback.length > 0) {
    const feedbackLines = feedback.map((f) => `  [${f.type}] ${f.target}: ${f.description}`);
    p.note(feedbackLines.join("\n"), `Feedback (${feedback.length})`);
  }

  p.outro(pc.dim("Done"));
}

// ==================== Helpers ====================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
