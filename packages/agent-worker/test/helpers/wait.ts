/**
 * Wait Helpers
 *
 * Async utilities for waiting on conditions in tests.
 * Consolidates from workflow-mock-backend.test.ts and workflow-simulation.test.ts.
 */

/**
 * Wait for a condition to become true, polling at intervals.
 * Throws on timeout.
 */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeout = 5000,
  interval = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timeout after ${timeout}ms waiting for condition`);
}

/**
 * Extract the inbox section from a prompt built by buildAgentPrompt().
 * The prompt mixes inbox + recent channel; behaviors must match on
 * inbox only to avoid reacting to historical channel messages.
 */
export function getInboxSection(prompt: string): string {
  const start = prompt.indexOf("## Inbox");
  const end = prompt.indexOf("## Recent Activity");
  if (start === -1) return "";
  return end === -1 ? prompt.slice(start) : prompt.slice(start, end);
}
