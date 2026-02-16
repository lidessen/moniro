/** Default workflow name for standalone agents */
export const DEFAULT_WORKFLOW = "global";

/** Default workflow tag */
export const DEFAULT_TAG = "main";

/** Default inbox polling interval in ms */
export const DEFAULT_POLL_INTERVAL = 5_000;

/** Default idle debounce for workflow exit detection */
export const DEFAULT_IDLE_DEBOUNCE = 2_000;

/** Default max retry attempts for worker failures */
export const DEFAULT_MAX_RETRIES = 3;

/** Default worker timeout in ms (10 minutes) */
export const DEFAULT_WORKER_TIMEOUT = 600_000;

/** Daemon discovery file path */
export const DAEMON_JSON_PATH = "~/.agent-worker/daemon.json";

/** Database file name */
export const DB_FILENAME = "agent-worker.db";

/** MCP tool names — Daemon MCP (context tools) */
export const TOOLS = {
  CHANNEL_SEND: "channel_send",
  CHANNEL_READ: "channel_read",
  MY_INBOX: "my_inbox",
  MY_INBOX_ACK: "my_inbox_ack",
  MY_STATUS_SET: "my_status_set",
  TEAM_MEMBERS: "team_members",
  TEAM_DOC_READ: "team_doc_read",
  TEAM_DOC_WRITE: "team_doc_write",
  TEAM_DOC_APPEND: "team_doc_append",
  TEAM_DOC_CREATE: "team_doc_create",
  TEAM_DOC_LIST: "team_doc_list",
  TEAM_PROPOSAL_CREATE: "team_proposal_create",
  TEAM_VOTE: "team_vote",
  TEAM_PROPOSAL_STATUS: "team_proposal_status",
  TEAM_PROPOSAL_CANCEL: "team_proposal_cancel",
  RESOURCE_CREATE: "resource_create",
  RESOURCE_READ: "resource_read",
} as const;
