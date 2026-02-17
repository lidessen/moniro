/**
 * Context — channel, inbox, resource operations backed by SQLite.
 *
 * All operations are synchronous (bun:sqlite is sync). The daemon
 * calls these directly; workers access via Daemon MCP tools.
 *
 * Documents are NOT here — they use a pluggable DocumentProvider.
 */
import type { Database } from "bun:sqlite";
import { nanoid } from "nanoid";
import type { Message, InboxMessage, Resource, ResourceType } from "../shared/types.ts";
import { extractMentions, calculatePriority, RESOURCE_PREFIX, RESOURCE_THRESHOLD } from "../shared/types.ts";

// ==================== Channel ====================

export interface ChannelSendOptions {
  /** Direct message target — only visible to sender and target */
  to?: string;
  /** Event kind override (default: 'message') */
  kind?: string;
  /** Extra metadata */
  metadata?: Record<string, unknown>;
  /** Skip auto-resource for long messages (e.g., kickoff must be delivered in full) */
  skipAutoResource?: boolean;
}

export interface ChannelSendResult {
  id: string;
  recipients: string[];
}

/**
 * Send a message to the channel. Parses @mentions at write time.
 * Returns the message ID and resolved recipients.
 */
export function channelSend(
  db: Database,
  sender: string,
  content: string,
  workflow: string,
  tag: string,
  options?: ChannelSendOptions,
): ChannelSendResult {
  // 1. Parse @mentions against known agents
  const agents = listAgentNames(db, workflow, tag);
  let recipients = extractMentions(content, [...agents, "all"]);

  // 2. Expand @all
  if (recipients.includes("all")) {
    recipients = agents.filter((a) => a !== sender);
  }

  // 3. DM handling
  if (options?.to) {
    recipients = [options.to];
  }

  // 4. Auto-resource for long messages (skip for kickoff / system messages)
  let finalContent = content;
  if (!options?.skipAutoResource && content.length > RESOURCE_THRESHOLD) {
    const resource = resourceCreate(db, content, "text", sender, workflow, tag);
    finalContent = `[Resource ${resource.id}]: ${content.slice(0, 200)}...`;
  }

  // 5. Insert message
  const id = nanoid();
  db.run(
    `INSERT INTO messages (id, workflow, tag, sender, content, recipients, kind, "to", metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      workflow,
      tag,
      sender,
      finalContent,
      JSON.stringify(recipients),
      options?.kind ?? "message",
      options?.to ?? null,
      options?.metadata ? JSON.stringify(options.metadata) : null,
      Date.now(),
    ],
  );

  return { id, recipients };
}

export interface ChannelReadOptions {
  since?: string;
  limit?: number;
  /** Agent requesting the read — used to filter DM visibility */
  agent?: string;
}

/**
 * DM filter: exclude DMs not involving the reader.
 * If no agent is specified (e.g., CLI peek), show all messages.
 */
function dmFilter(agent?: string): string {
  if (!agent) return "";
  return `AND ("to" IS NULL OR sender = ? OR "to" = ?)`;
}

/**
 * Read channel messages for a workflow.
 * DM messages are only visible to sender and recipient.
 */
export function channelRead(
  db: Database,
  workflow: string,
  tag: string,
  options?: ChannelReadOptions,
): Message[] {
  const limit = options?.limit ?? 100;
  const dmSql = dmFilter(options?.agent);
  const dmParams = options?.agent ? [options.agent, options.agent] : [];

  if (options?.since) {
    // Get the rowid of the 'since' message (sequential, no timestamp collision)
    const sinceMsg = db
      .query("SELECT rowid FROM messages WHERE id = ?")
      .get(options.since) as { rowid: number } | null;

    if (sinceMsg) {
      const rows = db
        .query(
          `SELECT * FROM messages WHERE workflow = ? AND tag = ? AND rowid > ?
           ${dmSql}
           ORDER BY rowid ASC LIMIT ?`,
        )
        .all(workflow, tag, sinceMsg.rowid, ...dmParams, limit) as MessageRow[];
      return rows.map(rowToMessage);
    }
  }

  const rows = db
    .query(
      `SELECT * FROM messages WHERE workflow = ? AND tag = ?
       ${dmSql}
       ORDER BY rowid DESC LIMIT ?`,
    )
    .all(workflow, tag, ...dmParams, limit) as MessageRow[];

  // Reverse to chronological order
  return rows.reverse().map(rowToMessage);
}

// ==================== Inbox ====================

/**
 * SQL fragment for matching messages addressed to an agent.
 * Uses json_each() to safely match recipients without LIKE injection.
 */
const RECIPIENT_MATCH_SQL = `EXISTS (
  SELECT 1 FROM json_each(messages.recipients) AS r
  WHERE r.value = ? OR r.value = 'all'
)`;

/**
 * Get unread messages for an agent (inbox).
 */
export function inboxQuery(
  db: Database,
  agent: string,
  workflow: string,
  tag: string,
): InboxMessage[] {
  // Get current cursor
  const ackRow = db
    .query("SELECT cursor FROM inbox_ack WHERE agent = ? AND workflow = ? AND tag = ?")
    .get(agent, workflow, tag) as { cursor: string } | null;

  let rows: MessageRow[];
  if (ackRow) {
    // Get the rowid of the cursor message (sequential, no timestamp collision)
    const cursorMsg = db
      .query("SELECT rowid FROM messages WHERE id = ?")
      .get(ackRow.cursor) as { rowid: number } | null;

    if (cursorMsg) {
      rows = db
        .query(
          `SELECT * FROM messages
           WHERE workflow = ? AND tag = ? AND rowid > ?
             AND ${RECIPIENT_MATCH_SQL}
             AND sender != ?
           ORDER BY rowid ASC`,
        )
        .all(workflow, tag, cursorMsg.rowid, agent, agent) as MessageRow[];
    } else {
      rows = [];
    }
  } else {
    // No cursor — all messages mentioning this agent
    rows = db
      .query(
        `SELECT * FROM messages
         WHERE workflow = ? AND tag = ?
           AND ${RECIPIENT_MATCH_SQL}
           AND sender != ?
         ORDER BY rowid ASC`,
      )
      .all(workflow, tag, agent, agent) as MessageRow[];
  }

  return rows.map((row) => {
    const msg = rowToMessage(row);
    return { message: msg, priority: calculatePriority(msg) };
  });
}

/**
 * Acknowledge inbox up to a message ID.
 */
export function inboxAck(
  db: Database,
  agent: string,
  workflow: string,
  tag: string,
  cursor: string,
): void {
  db.run(
    "INSERT OR REPLACE INTO inbox_ack (agent, workflow, tag, cursor) VALUES (?, ?, ?, ?)",
    [agent, workflow, tag, cursor],
  );
}

/**
 * Acknowledge all current inbox messages for an agent.
 */
export function inboxAckAll(
  db: Database,
  agent: string,
  workflow: string,
  tag: string,
): void {
  // Find the last message mentioning this agent (by rowid, not timestamp)
  const lastMsg = db
    .query(
      `SELECT id FROM messages
       WHERE workflow = ? AND tag = ?
         AND ${RECIPIENT_MATCH_SQL}
       ORDER BY rowid DESC LIMIT 1`,
    )
    .get(workflow, tag, agent) as { id: string } | null;

  if (lastMsg) {
    inboxAck(db, agent, workflow, tag, lastMsg.id);
  }
}

// ==================== Resources ====================

/**
 * Create a resource (content-addressed large content storage).
 */
export function resourceCreate(
  db: Database,
  content: string,
  type: ResourceType,
  createdBy: string,
  workflow: string,
  tag: string,
): Resource {
  const id = RESOURCE_PREFIX + nanoid(12);
  const now = Date.now();

  db.run(
    `INSERT INTO resources (id, workflow, tag, content, type, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, workflow, tag, content, type, createdBy, now],
  );

  return { id, workflow, tag, content, type, createdBy, createdAt: now };
}

/**
 * Read a resource by ID.
 */
export function resourceRead(db: Database, id: string): Resource | null {
  const row = db.query("SELECT * FROM resources WHERE id = ?").get(id) as ResourceRow | null;
  if (!row) return null;
  return {
    id: row.id,
    workflow: row.workflow,
    tag: row.tag,
    content: row.content,
    type: row.type as ResourceType,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// ==================== Agent Status ====================

/**
 * Update agent status (task, state).
 */
export function agentStatusSet(
  db: Database,
  agent: string,
  state?: string,
  _task?: string,
): void {
  if (state) {
    db.run("UPDATE agents SET state = ? WHERE name = ?", [state, agent]);
  }
  // Task stored as metadata — could extend agents table later
}

// ==================== Helpers ====================

/**
 * List agent names in a workflow (for @mention resolution).
 */
function listAgentNames(db: Database, workflow: string, tag: string): string[] {
  const rows = db
    .query("SELECT name FROM agents WHERE workflow = ? AND tag = ?")
    .all(workflow, tag) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

// ==================== Row types ====================

interface MessageRow {
  id: string;
  workflow: string;
  tag: string;
  sender: string;
  content: string;
  recipients: string | null;
  kind: string;
  to: string | null;
  metadata: string | null;
  created_at: number;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    workflow: row.workflow,
    tag: row.tag,
    sender: row.sender,
    content: row.content,
    recipients: row.recipients ? JSON.parse(row.recipients) : [],
    kind: row.kind as Message["kind"],
    to: row.to ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
  };
}

interface ResourceRow {
  id: string;
  workflow: string;
  tag: string;
  content: string;
  type: string;
  created_by: string;
  created_at: number;
}
