/**
 * Registry — agent and workflow CRUD, backed by SQLite.
 *
 * Pure data operations. No scheduling, no lifecycle management.
 * Every function takes a Database as its first argument.
 */
import type { Database } from "bun:sqlite";
import type { AgentConfig, AgentState, Workflow, WorkflowState } from "../shared/types.ts";

// ==================== Agents ====================

export interface CreateAgentInput {
  name: string;
  model: string;
  backend?: string;
  system?: string;
  workflow?: string;
  tag?: string;
  schedule?: string;
  configJson?: Record<string, unknown>;
}

export function createAgent(db: Database, input: CreateAgentInput): AgentConfig {
  const agent: AgentConfig = {
    name: input.name,
    model: input.model,
    backend: input.backend ?? "default",
    system: input.system,
    workflow: input.workflow ?? "global",
    tag: input.tag ?? "main",
    schedule: input.schedule,
    configJson: input.configJson,
    state: "idle",
    createdAt: Date.now(),
  };

  db.run(
    `INSERT INTO agents (name, model, backend, system, workflow, tag, schedule, config_json, state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      agent.name,
      agent.model,
      agent.backend,
      agent.system ?? null,
      agent.workflow,
      agent.tag,
      agent.schedule ?? null,
      agent.configJson ? JSON.stringify(agent.configJson) : null,
      agent.state,
      agent.createdAt,
    ],
  );

  return agent;
}

export function getAgent(db: Database, name: string): AgentConfig | null {
  const row = db.query("SELECT * FROM agents WHERE name = ?").get(name) as AgentRow | null;
  return row ? rowToAgent(row) : null;
}

export function listAgents(db: Database, workflow?: string, tag?: string): AgentConfig[] {
  let sql = "SELECT * FROM agents";
  const params: unknown[] = [];

  if (workflow) {
    sql += " WHERE workflow = ?";
    params.push(workflow);
    if (tag) {
      sql += " AND tag = ?";
      params.push(tag);
    }
  }

  sql += " ORDER BY created_at ASC";
  const rows = db.query(sql).all(...params) as AgentRow[];
  return rows.map(rowToAgent);
}

export function updateAgentState(db: Database, name: string, state: AgentState): void {
  db.run("UPDATE agents SET state = ? WHERE name = ?", [state, name]);
}

export function removeAgent(db: Database, name: string): boolean {
  const result = db.run("DELETE FROM agents WHERE name = ?", [name]);
  return result.changes > 0;
}

// ==================== Workflows ====================

export interface CreateWorkflowInput {
  name: string;
  tag?: string;
  configYaml?: string;
}

export function createWorkflow(db: Database, input: CreateWorkflowInput): Workflow {
  const wf: Workflow = {
    name: input.name,
    tag: input.tag ?? "main",
    configYaml: input.configYaml,
    state: "running",
    createdAt: Date.now(),
  };

  db.run(
    `INSERT OR REPLACE INTO workflows (name, tag, config_yaml, state, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [wf.name, wf.tag, wf.configYaml ?? null, wf.state, wf.createdAt],
  );

  return wf;
}

export function getWorkflow(db: Database, name: string, tag: string): Workflow | null {
  const row = db
    .query("SELECT * FROM workflows WHERE name = ? AND tag = ?")
    .get(name, tag) as WorkflowRow | null;
  return row ? rowToWorkflow(row) : null;
}

export function listWorkflows(db: Database): Workflow[] {
  const rows = db.query("SELECT * FROM workflows ORDER BY created_at ASC").all() as WorkflowRow[];
  return rows.map(rowToWorkflow);
}

export function updateWorkflowState(
  db: Database,
  name: string,
  tag: string,
  state: WorkflowState,
): void {
  db.run("UPDATE workflows SET state = ? WHERE name = ? AND tag = ?", [state, name, tag]);
}

export function removeWorkflow(db: Database, name: string, tag: string): boolean {
  const result = db.run("DELETE FROM workflows WHERE name = ? AND tag = ?", [name, tag]);
  return result.changes > 0;
}

// ==================== Ensure global workflow ====================

/** Ensure the @global:main workflow exists */
export function ensureGlobalWorkflow(db: Database): void {
  const existing = getWorkflow(db, "global", "main");
  if (!existing) {
    createWorkflow(db, { name: "global", tag: "main" });
  }
}

// ==================== Row mappers ====================

interface AgentRow {
  name: string;
  model: string;
  backend: string;
  system: string | null;
  workflow: string;
  tag: string;
  schedule: string | null;
  config_json: string | null;
  state: string;
  created_at: number;
}

function rowToAgent(row: AgentRow): AgentConfig {
  return {
    name: row.name,
    model: row.model,
    backend: row.backend,
    system: row.system ?? undefined,
    workflow: row.workflow,
    tag: row.tag,
    schedule: row.schedule ?? undefined,
    configJson: row.config_json ? JSON.parse(row.config_json) : undefined,
    state: row.state as AgentState,
    createdAt: row.created_at,
  };
}

interface WorkflowRow {
  name: string;
  tag: string;
  config_yaml: string | null;
  state: string;
  created_at: number;
}

function rowToWorkflow(row: WorkflowRow): Workflow {
  return {
    name: row.name,
    tag: row.tag,
    configYaml: row.config_yaml ?? undefined,
    state: row.state as WorkflowState,
    createdAt: row.created_at,
  };
}
