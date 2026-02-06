/**
 * File Context Provider
 * File-based storage with markdown format for human readability
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { ContextProvider } from './provider.js'
import type { ChannelEntry, InboxMessage, InboxState } from './types.js'
import { CONTEXT_DEFAULTS, ATTACHMENT_THRESHOLD, ATTACHMENTS_DIR, calculatePriority, extractMentions } from './types.js'

/**
 * File-based implementation of ContextProvider
 * Uses markdown format for channel (human-readable)
 */
export class FileContextProvider implements ContextProvider {
  private inboxState: InboxState = { readCursors: {} }
  private readonly inboxStatePath: string
  private readonly attachmentsDir: string

  constructor(
    private channelPath: string,
    private documentDir: string,
    private stateDir: string,
    private validAgents: string[],
    private contextDir?: string
  ) {
    this.inboxStatePath = join(stateDir, 'inbox-state.json')
    // Attachments dir is sibling to channel file
    this.attachmentsDir = join(contextDir || dirname(channelPath), ATTACHMENTS_DIR)
    this.ensureDirectories()
    this.loadInboxState()
  }

  private ensureDirectories(): void {
    for (const dir of [dirname(this.channelPath), this.documentDir, this.stateDir, this.attachmentsDir]) {
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

    // Check if message exceeds threshold
    if (message.length > ATTACHMENT_THRESHOLD) {
      // Create attachment file
      const attachmentName = this.generateAttachmentName(timestamp, from)
      const attachmentPath = join(this.attachmentsDir, attachmentName)
      writeFileSync(attachmentPath, message)

      // Create preview (first line or first 100 chars)
      const firstLine = message.split('\n')[0] || ''
      const preview = firstLine.length > 100 ? firstLine.slice(0, 100) + '...' : firstLine
      const attachmentRef = `${ATTACHMENTS_DIR}/${attachmentName}`

      const entry: ChannelEntry = {
        timestamp,
        from,
        message: preview,
        mentions,
        attachment: attachmentRef,
      }

      // Format with attachment reference
      const markdown = `\n### ${timestamp} [${from}]\n${preview}\n📎 See: ${attachmentRef}\n`
      appendFileSync(this.channelPath, markdown)

      return entry
    }

    // Normal message (under threshold)
    const entry: ChannelEntry = { timestamp, from, message, mentions }

    // Format: ### YYYY-MM-DDTHH:MM:SS.sssZ [agent]\nmessage\n
    // Using full ISO timestamp to preserve millisecond precision for filtering
    const markdown = `\n### ${timestamp} [${from}]\n${message}\n`

    appendFileSync(this.channelPath, markdown)

    return entry
  }

  /**
   * Generate attachment filename from timestamp and agent name
   * Format: 2026-02-06T08-30-00-123Z-agentname.md
   */
  private generateAttachmentName(timestamp: string, from: string): string {
    // Replace colons with dashes for filename compatibility
    const safeTimestamp = timestamp.replace(/:/g, '-')
    return `${safeTimestamp}-${from}.md`
  }

  /**
   * Read attachment content by path
   */
  async readAttachment(attachmentPath: string): Promise<string | null> {
    const fullPath = join(this.contextDir || dirname(this.channelPath), attachmentPath)
    try {
      if (existsSync(fullPath)) {
        return readFileSync(fullPath, 'utf-8')
      }
      return null
    } catch {
      return null
    }
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
   * 📎 See: attachments/xxx.md (optional)
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

    // Pattern to match attachment reference: 📎 See: attachments/xxx.md
    const attachmentPattern = /^📎 See: (.+)$/

    for (const line of lines) {
      // Try full ISO format first: ### 2026-02-05T14:30:22.123Z [agent]
      const isoMatch = line.match(/^### (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) \[([^\]]+)\]$/)
      // Fallback to legacy format: ### HH:MM:SS [agent]
      const legacyMatch = !isoMatch && line.match(/^### (\d{2}:\d{2}:\d{2}) \[([^\]]+)\]$/)

      if (isoMatch || legacyMatch) {
        // Save previous entry
        if (currentEntry && currentEntry.timestamp && currentEntry.from) {
          const { message, attachment } = this.extractMessageAndAttachment(messageLines, attachmentPattern)
          entries.push({
            timestamp: currentEntry.timestamp,
            from: currentEntry.from,
            message,
            mentions: extractMentions(message, this.validAgents),
            attachment,
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
      const { message, attachment } = this.extractMessageAndAttachment(messageLines, attachmentPattern)
      entries.push({
        timestamp: currentEntry.timestamp,
        from: currentEntry.from,
        message,
        mentions: extractMentions(message, this.validAgents),
        attachment,
      })
    }

    return entries
  }

  /**
   * Extract message content and attachment reference from lines
   */
  private extractMessageAndAttachment(
    lines: string[],
    attachmentPattern: RegExp
  ): { message: string; attachment?: string } {
    let attachment: string | undefined
    const contentLines: string[] = []

    for (const line of lines) {
      const attachMatch = line.match(attachmentPattern)
      if (attachMatch) {
        attachment = attachMatch[1]
      } else {
        contentLines.push(line)
      }
    }

    return {
      message: contentLines.join('\n').trim(),
      attachment,
    }
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
    validAgents,
    contextDir
  )
}
