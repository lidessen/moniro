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
 *
 * Remote sources are cloned (shallow) to a local cache directory:
 *   ~/.cache/agent-worker/sources/{owner}/{repo}/{ref}/
 *
 * The `sourceDir` field exposes the repo root, accessible in workflows
 * as ${{ source.dir }}.
 */

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

// ==================== Types ====================

/** Resolved workflow source — abstracts local vs remote */
export interface WorkflowSource {
  /** The raw YAML content */
  content: string;

  /** Display path (absolute local path or github: reference) */
  displayPath: string;

  /** Workflow name extracted from the source path (filename without extension) */
  inferredName: string;

  /**
   * Absolute path to the source root directory.
   * - Local: directory containing the workflow file
   * - Remote: root of the cloned repository
   *
   * Exposed as ${{ source.dir }} in workflow interpolation.
   */
  sourceDir: string;

  /**
   * Read a file relative to the workflow location.
   * For local: reads from filesystem relative to workflow dir.
   * For remote: reads from cloned repo relative to workflow path.
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
const CACHE_BASE = join(homedir(), ".cache", "agent-worker", "sources");

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
    sourceDir: workflowDir,
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
 *   Shorthand:  github:owner/repo[@ref]#name  -> workflows/name.yml
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

// ==================== Git Clone ====================

/**
 * Get cache directory for a repo+ref combination.
 */
function getCacheDir(ref: GitHubRef): string {
  return join(CACHE_BASE, ref.owner, ref.repo, ref.ref);
}

/**
 * Build the clone URL. Uses HTTPS; GITHUB_TOKEN auth via git credential helper
 * or the GIT_ASKPASS/GIT_AUTH mechanism handled by git itself.
 */
function getCloneUrl(ref: GitHubRef): string {
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    return `https://${token}@github.com/${ref.owner}/${ref.repo}.git`;
  }
  return `https://github.com/${ref.owner}/${ref.repo}.git`;
}

/**
 * Check if a ref looks like a branch/tag name (mutable) vs a commit SHA (immutable).
 * Commit SHAs are 7-40 hex chars.
 */
function isImmutableRef(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/.test(ref);
}

/**
 * Clone or update a remote repo to the cache directory.
 *
 * Strategy:
 * - If cache exists and ref is immutable (SHA): skip, use cached
 * - If cache exists and ref is mutable (branch/tag): git fetch + reset
 * - If cache doesn't exist: shallow clone
 *
 * @returns Absolute path to the cache directory (repo root)
 */
function ensureClone(ref: GitHubRef): string {
  const cacheDir = getCacheDir(ref);

  if (existsSync(join(cacheDir, ".git"))) {
    // Cache exists — check if we need to update
    if (isImmutableRef(ref.ref)) {
      return cacheDir; // SHA is immutable, no update needed
    }

    // Mutable ref (branch/tag) — fetch and reset
    try {
      execSync(`git fetch origin ${ref.ref} --depth 1`, {
        cwd: cacheDir,
        stdio: "pipe",
        timeout: 30_000,
      });
      execSync(`git reset --hard FETCH_HEAD`, {
        cwd: cacheDir,
        stdio: "pipe",
        timeout: 10_000,
      });
      return cacheDir;
    } catch {
      // Fetch failed — try fresh clone below
    }
  }

  // Fresh clone
  mkdirSync(dirname(cacheDir), { recursive: true });

  // Remove stale cache if partial clone left behind
  if (existsSync(cacheDir)) {
    execSync(`rm -rf ${JSON.stringify(cacheDir)}`, { stdio: "pipe" });
  }

  const url = getCloneUrl(ref);
  execSync(
    `git clone --depth 1 --single-branch --branch ${ref.ref} ${JSON.stringify(url)} ${JSON.stringify(cacheDir)}`,
    { stdio: "pipe", timeout: 60_000 },
  );

  return cacheDir;
}

/** Resolve a github: reference to a WorkflowSource */
async function resolveGitHubSource(input: string): Promise<WorkflowSource> {
  const ref = parseGitHubRef(input);

  // Clone (or update) repo to local cache
  const repoDir = ensureClone(ref);

  // Read workflow file from cloned repo
  const workflowPath = join(repoDir, ref.path);
  if (!existsSync(workflowPath)) {
    throw new Error(
      `Remote workflow not found: ${ref.path}\n` +
        `  Source: ${input}\n` +
        `  Parsed: ${ref.owner}/${ref.repo}@${ref.ref} -> ${ref.path}\n` +
        `  Clone: ${repoDir}`,
    );
  }

  const content = readFileSync(workflowPath, "utf-8");

  // Directory containing the workflow file (for relative path resolution)
  const workflowDir = dirname(workflowPath);
  const inferredName = basename(ref.path, ".yml").replace(".yaml", "");

  return {
    content,
    displayPath: `${GITHUB_PREFIX}${ref.owner}/${ref.repo}@${ref.ref}/${ref.path}`,
    inferredName,
    sourceDir: repoDir,
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
