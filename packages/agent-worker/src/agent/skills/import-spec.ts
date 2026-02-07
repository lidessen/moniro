import { z } from 'zod'

export type GitProvider = 'github' | 'gitlab' | 'gitee'

export interface ImportSpec {
  provider: GitProvider
  owner: string
  repo: string
  ref: string // branch/tag/commit
  skills: string[] | 'all'
  rawSpec: string
}

const providerUrls: Record<GitProvider, string> = {
  github: 'https://github.com',
  gitlab: 'https://gitlab.com',
  gitee: 'https://gitee.com',
}

/**
 * Parse import spec: [provider:]owner/repo[@ref]:{skill1,skill2,...}
 *
 * Examples:
 *   vercel-labs/agent-skills:react-best-practices
 *   vercel-labs/agent-skills:{react,web}
 *   vercel-labs/agent-skills@v1.0.0:react
 *   github:vercel-labs/agent-skills@main:react
 *   vercel-labs/agent-skills  (imports all)
 */
export function parseImportSpec(spec: string): ImportSpec {
  // Pattern: [provider:]owner/repo[@ref]:{skills}
  const pattern =
    /^(?:([a-z]+):)?([^/@:]+)\/([^/@:]+)(?:@([^:]+))?(?::(.+))?$/

  const match = spec.match(pattern)
  if (!match) {
    throw new Error(
      `Invalid import spec: ${spec}\nFormat: [provider:]owner/repo[@ref]:{skill1,skill2,...}`
    )
  }

  const [, providerMatch = 'github', ownerMatch, repoMatch, refMatch = 'main', skillsStr] = match

  // Validate required captures
  if (!ownerMatch || !repoMatch) {
    throw new Error(
      `Invalid import spec: ${spec}\nFormat: [provider:]owner/repo[@ref]:{skill1,skill2,...}`
    )
  }

  const provider = providerMatch
  const owner = ownerMatch
  const repo = repoMatch
  const ref = refMatch

  // Validate provider
  if (!['github', 'gitlab', 'gitee'].includes(provider)) {
    throw new Error(
      `Unsupported provider: ${provider}. Supported: github, gitlab, gitee`
    )
  }

  // Security: Validate owner, repo, and ref to prevent git argument injection
  // Only allow: alphanumeric, hyphen, underscore, dot (but not starting with - or .)
  const safeNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

  if (!safeNamePattern.test(owner)) {
    throw new Error(
      `Invalid owner: "${owner}". Must start with alphanumeric and only contain alphanumeric, hyphen, underscore, or dot`
    )
  }

  if (!safeNamePattern.test(repo)) {
    throw new Error(
      `Invalid repo: "${repo}". Must start with alphanumeric and only contain alphanumeric, hyphen, underscore, or dot`
    )
  }

  if (!safeNamePattern.test(ref)) {
    throw new Error(
      `Invalid ref: "${ref}". Must start with alphanumeric and only contain alphanumeric, hyphen, underscore, or dot`
    )
  }

  // Parse skills
  let skills: string[] | 'all' = 'all'
  if (skillsStr) {
    if (skillsStr.startsWith('{') && skillsStr.endsWith('}')) {
      // {a,b,c} -> ['a', 'b', 'c']
      const skillList = skillsStr
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)

      if (skillList.length === 0) {
        throw new Error('Empty skill list in braces')
      }
      skills = skillList
    } else {
      // single skill
      skills = [skillsStr.trim()]
    }
  }

  return {
    provider: provider as GitProvider,
    owner,
    repo,
    ref,
    skills,
    rawSpec: spec,
  }
}

/**
 * Build Git URL from import spec
 */
export function buildGitUrl(spec: ImportSpec): string {
  const baseUrl = providerUrls[spec.provider]
  return `${baseUrl}/${spec.owner}/${spec.repo}.git`
}

/**
 * Get display name for import spec
 */
export function getSpecDisplayName(spec: ImportSpec): string {
  const skillsDisplay =
    spec.skills === 'all'
      ? 'all skills'
      : spec.skills.length === 1
        ? spec.skills[0]
        : `${spec.skills.length} skills`

  return `${spec.owner}/${spec.repo}@${spec.ref} (${skillsDisplay})`
}
