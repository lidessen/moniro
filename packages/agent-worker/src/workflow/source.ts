/**
 * Workflow source resolver — supports local files and remote GitHub references.
 *
 * Formats:
 *   Local:  ./review.yml, /path/to/review.yml, review.yml
 *
 *   Remote (full path):
 *     github:owner/repo@ref/path/file.yml    (pinned to ref)
 *     github:owner/repo/path/file.yml         (default branch: main)
 *
 *   Remote (shorthand — resolves to workflows/<name>.yml):
 *     github:owner/repo@ref#name
 *     github:owner/repo#name
 *
 * The @ref is always on the repo segment (format D), keeping repo+version
 * as a single semantic unit.
 */

import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// ==================== Types ====================

/** Resolved workflow source — abstracts local vs remote */
export interface WorkflowSource {
  /** The raw YAML content */
  content: string;

  /** Display path (absolute local path or remote URL) */
  displayPath: string;

  /** Workflow name extracted from the source path (filename without extension) */
  inferredName: string;

  /**
   * Read a file relative to the workflow location.
   * For local: reads from filesystem relative to workflow dir.
   * For remote: fetches from same repo/ref relative to workflow path.
   * Returns null if not found.
   */
  readRelativeFile(relativePath: string): Promise<string | null>;
}

/** Parsed GitHub reference */
export interface GitHubRef {
  owner: string;
  repo: string;
  ref: string;
  /** Path within the repo (e.g. "workflows/review.yml") */
  path: string;
}

// ==================== Constants ====================

const GITHUB_PREFIX = "github:";
const DEFAULT_REF = "main";
const RAW_BASE = "https://raw.githubusercontent.com";

// ==================== Public API ====================

/** Check if the input is a remote source reference */
export function isRemoteSource(input: string): boolean {
  return input.startsWith(GITHUB_PREFIX);
}

/**
 * Resolve a workflow source — local file or remote GitHub reference.
 * Returns a WorkflowSource that can read the YAML and resolve relative files.
 */
export async function resolveSource(input: string): Promise<WorkflowSource> {
  if (isRemoteSource(input)) {
    return resolveGitHubSource(input);
  }
  return resolveLocalSource(input);
}

// ==================== Local Source ====================

function resolveLocalSource(filePath: string): WorkflowSource {
  const absolutePath = resolve(filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Workflow file not found: ${absolutePath}`);
  }

  const content = readFileSync(absolutePath, "utf-8");
  const workflowDir = dirname(absolutePath);
  const inferredName = basename(absolutePath, ".yml").replace(".yaml", "");

  return {
    content,
    displayPath: absolutePath,
    inferredName,
    readRelativeFile: async (relativePath: string) => {
      const fullPath = relativePath.startsWith("/")
        ? relativePath
        : join(workflowDir, relativePath);
      if (existsSync(fullPath)) {
        return readFileSync(fullPath, "utf-8");
      }
      return null;
    },
  };
}

// ==================== GitHub Source ====================

/**
 * Parse a github: reference string into its components.
 *
 * Supports two formats:
 *   Full path:  github:owner/repo[@ref]/path/to/file.yml
 *   Shorthand:  github:owner/repo[@ref]#name  → workflows/name.yml
 */
export function parseGitHubRef(input: string): GitHubRef {
  if (!input.startsWith(GITHUB_PREFIX)) {
    throw new Error(`Not a GitHub reference: "${input}"`);
  }

  const rest = input.slice(GITHUB_PREFIX.length);

  // Check for shorthand: owner/repo[@ref]#name
  const hashIdx = rest.indexOf("#");
  if (hashIdx !== -1) {
    const repoStr = rest.slice(0, hashIdx);
    const name = rest.slice(hashIdx + 1);

    if (!name) {
      throw new Error(`Missing workflow name after '#' in: "${input}"`);
    }

    const { owner, repo, ref } = parseRepoSegment(repoStr);
    return { owner, repo, ref, path: `workflows/${name}.yml` };
  }

  // Full path: owner/repo[@ref]/path/to/file.yml
  const firstSlash = rest.indexOf("/");
  const secondSlash = firstSlash === -1 ? -1 : rest.indexOf("/", firstSlash + 1);

  if (firstSlash === -1 || secondSlash === -1) {
    throw new Error(
      `Invalid GitHub reference: "${input}". ` +
        `Expected: github:owner/repo/path or github:owner/repo#name`,
    );
  }

  const repoStr = rest.slice(0, secondSlash);
  const path = rest.slice(secondSlash + 1);

  if (!path) {
    throw new Error(`Missing file path in: "${input}"`);
  }

  const { owner, repo, ref } = parseRepoSegment(repoStr);
  return { owner, repo, ref, path };
}

/** Parse "owner/repo" or "owner/repo@ref" */
function parseRepoSegment(repoStr: string): { owner: string; repo: string; ref: string } {
  let ref = DEFAULT_REF;

  // Extract @ref from repo segment
  const atIdx = repoStr.indexOf("@");
  let cleanStr = repoStr;
  if (atIdx !== -1) {
    ref = repoStr.slice(atIdx + 1);
    cleanStr = repoStr.slice(0, atIdx);
    if (!ref) {
      throw new Error(`Empty ref after '@' in: "${repoStr}"`);
    }
  }

  const parts = cleanStr.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository format: "${repoStr}". Expected "owner/repo"`);
  }

  return { owner: parts[0], repo: parts[1], ref };
}

/** Build raw.githubusercontent.com URL */
function buildRawUrl(ref: GitHubRef, filePath?: string): string {
  const path = filePath ?? ref.path;
  return `${RAW_BASE}/${ref.owner}/${ref.repo}/${ref.ref}/${path}`;
}

/** Fetch a file from GitHub raw content */
async function fetchGitHubFile(url: string): Promise<string | null> {
  const headers: Record<string, string> = {};

  // Support private repos via GITHUB_TOKEN
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers["Authorization"] = `token ${token}`;
  }

  const response = await fetch(url, { headers });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/** Resolve a github: reference to a WorkflowSource */
async function resolveGitHubSource(input: string): Promise<WorkflowSource> {
  const ref = parseGitHubRef(input);
  const url = buildRawUrl(ref);

  const content = await fetchGitHubFile(url);
  if (content === null) {
    throw new Error(
      `Remote workflow not found: ${url}\n` +
        `  Source: ${input}\n` +
        `  Parsed: ${ref.owner}/${ref.repo}@${ref.ref} → ${ref.path}`,
    );
  }

  // Determine the "directory" of the remote file for relative resolution
  const pathDir = ref.path.includes("/") ? ref.path.slice(0, ref.path.lastIndexOf("/")) : "";

  const inferredName = basename(ref.path, ".yml").replace(".yaml", "");

  return {
    content,
    displayPath: `${GITHUB_PREFIX}${ref.owner}/${ref.repo}@${ref.ref}/${ref.path}`,
    inferredName,
    readRelativeFile: async (relativePath: string) => {
      // Resolve relative path against the workflow's directory in the repo
      const resolvedPath = pathDir ? `${pathDir}/${relativePath}` : relativePath;
      const fileUrl = buildRawUrl(ref, resolvedPath);
      return fetchGitHubFile(fileUrl);
    },
  };
}
