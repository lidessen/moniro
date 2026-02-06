/**
 * File Context Provider
 * File-based storage with markdown format for human readability
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { ContextProvider } from './provider.js'
import type { ChannelEntry, InboxMessage, InboxState } from './types.js'
import { CONTEXT_DEFAULTS, calculatePriority, extractMentions } from './types.js'

/**
 * File-based implementation of ContextProvider
 * Uses markdown format for channel (human-readable)
 */
export class FileContextProvider implements ContextProvider {
  private inboxState: InboxState = { readCursors: {} }
  private readonly inboxStatePath: string

  constructor(
    private channelPath: string,
    private documentDir: string,
    private stateDir: string,
    private validAgents: string[]
  ) {
    this.inboxStatePath = join(stateDir, 'inbox-state.json')
    this.ensureDirectories()
    this.loadInboxState()
  }

  private ensureDirectories(): void {
    for (const dir of [dirname(this.channelPath), this.documentDir, this.stateDir]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
  }

  private loadInboxState(): void {
    try {
      if (existsSync(this.inboxStatePath)) {
        const data = JSON.parse(readFileSync(this.inboxStatePath, 'utf-8'))
        this.inboxState = { readCursors: data.readCursors || data || {} }
      }
    } catch {
      // No state file yet or invalid JSON - start fresh
    }
  }

  private saveInboxState(): void {
    const data = { readCursors: this.inboxState.readCursors }
    writeFileSync(this.inboxStatePath, JSON.stringify(data, null, 2))
  }

  async appendChannel(from: string, message: string): Promise<ChannelEntry> {
    const timestamp = new Date().toISOString()
    const mentions = extractMentions(message, this.validAgents)
    const entry: ChannelEntry = { timestamp, from, message, mentions }

    // Format: ### YYYY-MM-DDTHH:MM:SS.sssZ [agent]\nmessage\n
    // Using full ISO timestamp to preserve millisecond precision for filtering
    const markdown = `\n### ${timestamp} [${from}]\n${message}\n`

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
   * Format (current - full ISO timestamp):
   * ### 2026-02-05T14:30:22.123Z [agent]
   * message content
   * possibly multiple lines
   *
   * Format (legacy - time only, assumes today):
   * ### HH:MM:SS [agent]
   * message content
   */
  private parseChannelMarkdown(content: string): ChannelEntry[] {
    const entries: ChannelEntry[] = []
    const lines = content.split('\n')

    let currentEntry: Partial<ChannelEntry> | null = null
    let messageLines: string[] = []

    for (const line of lines) {
      // Try full ISO format first: ### 2026-02-05T14:30:22.123Z [agent]
      const isoMatch = line.match(/^### (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) \[([^\]]+)\]$/)
      // Fallback to legacy format: ### HH:MM:SS [agent]
      const legacyMatch = !isoMatch && line.match(/^### (\d{2}:\d{2}:\d{2}) \[([^\]]+)\]$/)

      if (isoMatch || legacyMatch) {
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
        let timestamp: string
        let from: string

        if (isoMatch) {
          timestamp = isoMatch[1]!
          from = isoMatch[2]!
        } else {
          // legacyMatch is guaranteed here since we're in isoMatch || legacyMatch block
          const match = legacyMatch as RegExpMatchArray
          const timeStr = match[1]!
          from = match[2]!
          // Legacy format: use today's date
          const today = new Date().toISOString().slice(0, 10)
          timestamp = `${today}T${timeStr}.000Z`
        }

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

  async getInbox(agent: string): Promise<InboxMessage[]> {
    const lastAck = this.inboxState.readCursors[agent] || ''
    const entries = await this.readChannel(lastAck)

    return entries
      .filter((e) => e.mentions.includes(agent))
      .map((entry) => ({
        entry,
        priority: calculatePriority(entry),
      }))
  }

  async ackInbox(agent: string, until: string): Promise<void> {
    this.inboxState.readCursors[agent] = until
    this.saveInboxState()
  }

  private getDocumentPath(file?: string): string {
    const docFile = file || CONTEXT_DEFAULTS.document
    return join(this.documentDir, docFile)
  }

  async readDocument(file?: string): Promise<string> {
    const docPath = this.getDocumentPath(file)
    try {
      if (existsSync(docPath)) {
        return readFileSync(docPath, 'utf-8')
      }
      return ''
    } catch {
      return ''
    }
  }

  async writeDocument(content: string, file?: string): Promise<void> {
    const docPath = this.getDocumentPath(file)
    const dir = dirname(docPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(docPath, content)
  }

  async appendDocument(content: string, file?: string): Promise<void> {
    const docPath = this.getDocumentPath(file)
    const dir = dirname(docPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    appendFileSync(docPath, content)
  }

  async listDocuments(): Promise<string[]> {
    if (!existsSync(this.documentDir)) {
      return []
    }

    const files: string[] = []
    const walk = (dir: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(relative(this.documentDir, fullPath))
        }
      }
    }
    walk(this.documentDir)

    return files.sort()
  }

  async createDocument(file: string, content: string): Promise<void> {
    const docPath = this.getDocumentPath(file)
    if (existsSync(docPath)) {
      throw new Error(`Document already exists: ${file}`)
    }
    const dir = dirname(docPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(docPath, content)
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
    documentDir?: string
  }
): FileContextProvider {
  const channelFile = options?.channelFile ?? CONTEXT_DEFAULTS.channel
  const documentDir = options?.documentDir ?? CONTEXT_DEFAULTS.documentDir
  const stateDir = CONTEXT_DEFAULTS.stateDir

  return new FileContextProvider(
    join(contextDir, channelFile),
    join(contextDir, documentDir),
    join(contextDir, stateDir),
    validAgents
  )
}
