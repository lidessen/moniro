/**
 * SQLite database — schema, migrations, and query helpers.
 *
 * Single source of truth for all system state (messages, agents,
 * workflows, proposals, resources). Documents are NOT here — they
 * use a pluggable DocumentProvider.
 */
import { Database } from "bun:sqlite";

/** Schema version — bump when tables change */
const SCHEMA_VERSION = 1;

const SCHEMA = `
-- Agents
CREATE TABLE IF NOT EXISTS agents (
  name        TEXT PRIMARY KEY,
  model       TEXT NOT NULL,
  backend     TEXT NOT NULL DEFAULT 'default',
  system      TEXT,
  workflow    TEXT NOT NULL DEFAULT 'global',
  tag         TEXT NOT NULL DEFAULT 'main',
  schedule    TEXT,
  config_json TEXT,
  state       TEXT NOT NULL DEFAULT 'idle',
  created_at  INTEGER NOT NULL
);

-- Workflows
CREATE TABLE IF NOT EXISTS workflows (
  name        TEXT NOT NULL,
  tag         TEXT NOT NULL,
  config_yaml TEXT,
  state       TEXT NOT NULL DEFAULT 'running',
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (name, tag)
);

-- Messages (channel + inbox unified)
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  workflow    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  sender      TEXT NOT NULL,
  content     TEXT NOT NULL,
  recipients  TEXT,
  kind        TEXT NOT NULL DEFAULT 'message',
  "to"        TEXT,
  metadata    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_wf ON messages(workflow, tag, created_at);

-- Inbox acknowledgment
CREATE TABLE IF NOT EXISTS inbox_ack (
  agent     TEXT NOT NULL,
  workflow  TEXT NOT NULL,
  tag       TEXT NOT NULL,
  cursor    TEXT NOT NULL,
  PRIMARY KEY (agent, workflow, tag)
);

-- Resources
CREATE TABLE IF NOT EXISTS resources (
  id          TEXT PRIMARY KEY,
  workflow    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  content     TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'text',
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Proposals
CREATE TABLE IF NOT EXISTS proposals (
  id          TEXT PRIMARY KEY,
  workflow    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  options     TEXT NOT NULL,
  resolution  TEXT NOT NULL DEFAULT 'plurality',
  binding     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'active',
  creator     TEXT NOT NULL,
  result      TEXT,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);

-- Votes
CREATE TABLE IF NOT EXISTS votes (
  proposal_id TEXT NOT NULL,
  agent       TEXT NOT NULL,
  choice      TEXT NOT NULL,
  reason      TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, agent),
  FOREIGN KEY (proposal_id) REFERENCES proposals(id)
);

-- Workers (process tracking)
CREATE TABLE IF NOT EXISTS workers (
  agent       TEXT NOT NULL,
  workflow    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  pid         INTEGER,
  state       TEXT NOT NULL DEFAULT 'idle',
  started_at  INTEGER,
  last_heartbeat INTEGER,
  PRIMARY KEY (agent, workflow, tag)
);

-- Schema version
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

/**
 * Open (or create) the SQLite database, run migrations, enable WAL.
 */
export function openDatabase(path: string): Database {
  const db = new Database(path);

  // WAL mode for concurrent reads
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");

  migrate(db);
  return db;
}

/**
 * Open an in-memory database (for testing).
 */
export function openMemoryDatabase(): Database {
  return openDatabase(":memory:");
}

function migrate(db: Database) {
  const version = getSchemaVersion(db);
  if (version < SCHEMA_VERSION) {
    db.exec(SCHEMA);
    setSchemaVersion(db, SCHEMA_VERSION);
  }
}

function getSchemaVersion(db: Database): number {
  try {
    const row = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | null;
    return row ? Number.parseInt(row.value, 10) : 0;
  } catch {
    // meta table doesn't exist yet
    return 0;
  }
}

function setSchemaVersion(db: Database, version: number) {
  db.run(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
    [String(version)],
  );
}
