/**
 * Channel display formatting
 * Terminal output formatting for workflow channel messages.
 */

import type { ContextProvider } from './context/provider.ts'
import type { Message } from './context/types.ts'

// ==================== Internal Helpers ====================

/** ANSI color codes for terminal output */
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  // Agent colors (cycle through these)
  agents: [
    '\x1b[36m', // cyan
    '\x1b[33m', // yellow
    '\x1b[35m', // magenta
    '\x1b[32m', // green
    '\x1b[34m', // blue
    '\x1b[91m', // bright red
  ],
  system: '\x1b[90m', // gray for system messages
}

/** Get consistent color for an agent name */
function getAgentColor(agentName: string, agentNames: string[]): string {
  if (agentName === 'system' || agentName === 'user') {
    return colors.system
  }
  const index = agentNames.indexOf(agentName)
  return colors.agents[index % colors.agents.length] ?? colors.agents[0]!
}

/** Format timestamp as HH:MM:SS */
function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toTimeString().slice(0, 8)
}

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ==================== Exported API ====================

/** Format a channel entry for display */
export function formatChannelEntry(entry: Message, agentNames: string[]): string {
  const time = formatTime(entry.timestamp)
  const color = getAgentColor(entry.from, agentNames)
  const name = entry.from.padEnd(12)

  // Truncate very long messages, show first part
  const maxLen = 500
  let message = entry.content
  if (message.length > maxLen) {
    message = message.slice(0, maxLen) + '...'
  }

  // Handle multi-line messages: indent continuation lines
  const lines = message.split('\n')
  if (lines.length === 1) {
    return `${colors.dim}${time}${colors.reset} ${color}${name}${colors.reset} │ ${message}`
  }

  const firstLine = `${colors.dim}${time}${colors.reset} ${color}${name}${colors.reset} │ ${lines[0]}`
  const indent = ' '.repeat(22) + '│ '
  const rest = lines.slice(1).map(l => indent + l).join('\n')
  return firstLine + '\n' + rest
}

/** Channel watcher state */
export interface ChannelWatcher {
  stop: () => void
}

/** Start watching channel and logging new entries */
export function startChannelWatcher(
  contextProvider: ContextProvider,
  agentNames: string[],
  log: (msg: string) => void,
  pollInterval = 500
): ChannelWatcher {
  let lastTimestamp: string | undefined
  let running = true

  const poll = async () => {
    while (running) {
      try {
        const entries = await contextProvider.readChannel({ since: lastTimestamp })
        for (const entry of entries) {
          // Skip if we've already seen this (readChannel is "since", not "after")
          if (lastTimestamp && entry.timestamp <= lastTimestamp) continue

          log(formatChannelEntry(entry, agentNames))
          lastTimestamp = entry.timestamp
        }
      } catch {
        // Ignore errors during polling
      }
      await sleep(pollInterval)
    }
  }

  // Start polling
  poll()

  return {
    stop: () => { running = false }
  }
}
