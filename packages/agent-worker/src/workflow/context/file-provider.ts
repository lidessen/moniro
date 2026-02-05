/**
 * File Context Provider
 * File-based storage with markdown format for human readability
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ContextProvider } from './provider.js'
import type { ChannelEntry, MentionNotification } from './types.js'
import { extractMentions } from './types.js'

/**
 * File-based implementation of ContextProvider
 * Uses markdown format for channel (human-readable)
 */
export class FileContextProvider implements ContextProvider {
  private mentionState: Map<string, string> = new Map() // agent -> last ack timestamp

  constructor(
    private channelPath: string,
    private documentPath: string,
    private mentionStatePath: string,
    private validAgents: string[]
  ) {
    this.ensureDirectories()
    this.loadMentionState()
  }

  private ensureDirectories(): void {
    for (const filePath of [this.channelPath, this.documentPath, this.mentionStatePath]) {
      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
  }

  private loadMentionState(): void {
    try {
      if (existsSync(this.mentionStatePath)) {
        const data = JSON.parse(readFileSync(this.mentionStatePath, 'utf-8'))
        this.mentionState = new Map(Object.entries(data))
      }
    } catch {
      // No state file yet or invalid JSON - start fresh
    }
  }

  private saveMentionState(): void {
    const data = Object.fromEntries(this.mentionState)
    writeFileSync(this.mentionStatePath, JSON.stringify(data, null, 2))
  }

  async appendChannel(from: string, message: string): Promise<ChannelEntry> {
    const timestamp = new Date().toISOString()
    const mentions = extractMentions(message, this.validAgents)
    const entry: ChannelEntry = { timestamp, from, message, mentions }

    // Format: ### HH:MM:SS [agent]\nmessage\n
    const timeStr = timestamp.slice(11, 19) // Extract HH:MM:SS
    const markdown = `\n### ${timeStr} [${from}]\n${message}\n`

    appendFileSync(this.channelPath, markdown)

    return entry
  }

  async readChannel(since?: string, limit?: number): Promise<ChannelEntry[]> {
    if (!existsSync(this.channelPath)) {
      return []
    }

    const content = readFileSync(this.channelPath, 'utf-8')
    const entries = this.parseChannelMarkdown(content)

    let filtered = entries
    if (since) {
      filtered = filtered.filter((e) => e.timestamp > since)
    }

    if (limit && limit > 0) {
      filtered = filtered.slice(-limit)
    }

    return filtered
  }

  /**
   * Parse channel markdown into structured entries
   *
   * Format:
   * ### HH:MM:SS [agent]
   * message content
   * possibly multiple lines
   *
   * ### HH:MM:SS [another-agent]
   * another message
   */
  private parseChannelMarkdown(content: string): ChannelEntry[] {
    const entries: ChannelEntry[] = []

    // Match: ### HH:MM:SS [agent]
    const headerPattern = /^### (\d{2}:\d{2}:\d{2}) \[([^\]]+)\]$/gm
    const lines = content.split('\n')

    let currentEntry: Partial<ChannelEntry> | null = null
    let messageLines: string[] = []

    for (const line of lines) {
      const headerMatch = line.match(/^### (\d{2}:\d{2}:\d{2}) \[([^\]]+)\]$/)

      if (headerMatch) {
        // Save previous entry
        if (currentEntry && currentEntry.timestamp && currentEntry.from) {
          const message = messageLines.join('\n').trim()
          entries.push({
            timestamp: currentEntry.timestamp,
            from: currentEntry.from,
            message,
            mentions: extractMentions(message, this.validAgents),
          })
        }

        // Start new entry
        const timeStr = headerMatch[1]
        const from = headerMatch[2]

        // Construct ISO timestamp (using today's date as base)
        const today = new Date().toISOString().slice(0, 10)
        const timestamp = `${today}T${timeStr}.000Z`

        currentEntry = { timestamp, from }
        messageLines = []
      } else if (currentEntry) {
        messageLines.push(line)
      }
    }

    // Save last entry
    if (currentEntry && currentEntry.timestamp && currentEntry.from) {
      const message = messageLines.join('\n').trim()
      entries.push({
        timestamp: currentEntry.timestamp,
        from: currentEntry.from,
        message,
        mentions: extractMentions(message, this.validAgents),
      })
    }

    return entries
  }

  async getUnreadMentions(agent: string): Promise<MentionNotification[]> {
    const lastAck = this.mentionState.get(agent) || ''
    const entries = await this.readChannel(lastAck)

    return entries
      .filter((e) => e.mentions.includes(agent))
      .map((e) => ({
        from: e.from,
        target: agent,
        message: e.message,
        timestamp: e.timestamp,
      }))
  }

  async acknowledgeMentions(agent: string, until: string): Promise<void> {
    this.mentionState.set(agent, until)
    this.saveMentionState()
  }

  async readDocument(): Promise<string> {
    try {
      if (existsSync(this.documentPath)) {
        return readFileSync(this.documentPath, 'utf-8')
      }
      return ''
    } catch {
      return ''
    }
  }

  async writeDocument(content: string): Promise<void> {
    writeFileSync(this.documentPath, content)
  }

  async appendDocument(content: string): Promise<void> {
    appendFileSync(this.documentPath, content)
  }
}

/**
 * Create a FileContextProvider with default paths
 */
export function createFileContextProvider(
  contextDir: string,
  validAgents: string[],
  options?: {
    channelFile?: string
    documentFile?: string
  }
): FileContextProvider {
  const channelFile = options?.channelFile ?? 'channel.md'
  const documentFile = options?.documentFile ?? 'notes.md'

  return new FileContextProvider(
    `${contextDir}/${channelFile}`,
    `${contextDir}/${documentFile}`,
    `${contextDir}/.mention-state.json`,
    validAgents
  )
}
