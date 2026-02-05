/**
 * Skills support utilities for different backends
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { BackendType } from '../backends/types.ts'

export interface SkillsCompatibility {
  supported: boolean
  method: 'tool' | 'filesystem' | 'none'
  locations?: string[]
  warning?: string
}

/**
 * Get skills compatibility info for a backend
 */
export function getSkillsCompatibility(
  backendType: BackendType,
  cwd?: string
): SkillsCompatibility {
  switch (backendType) {
    case 'sdk':
      return {
        supported: true,
        method: 'tool',
      }

    case 'claude':
      return {
        supported: true,
        method: 'filesystem',
        locations: [
          join(cwd || process.cwd(), '.claude/skills'),
          join(homedir(), '.claude/skills'),
        ],
      }

    case 'codex':
      return {
        supported: true,
        method: 'filesystem',
        locations: [
          join(cwd || process.cwd(), '.agents/skills'),
          join(homedir(), '.codex/skills'),
          join(homedir(), '.agents/skills'),
        ],
      }

    case 'cursor':
      return {
        supported: true,
        method: 'filesystem',
        locations: [
          join(cwd || process.cwd(), '.agents/skills'),
          join(cwd || process.cwd(), '.cursor/skills'),
          join(homedir(), '.agents/skills'),
        ],
      }

    default:
      return {
        supported: false,
        method: 'none',
        warning: `Backend '${backendType}' does not support skills`,
      }
  }
}

/**
 * Check if skills are available for a CLI backend
 */
export function checkSkillsAvailability(backendType: BackendType, cwd?: string): {
  available: boolean
  foundIn?: string
  suggestions: string[]
} {
  const compat = getSkillsCompatibility(backendType, cwd)

  if (compat.method === 'tool') {
    return { available: true, suggestions: [] }
  }

  if (compat.method === 'none') {
    return {
      available: false,
      suggestions: [compat.warning || 'Skills not supported for this backend'],
    }
  }

  // Check filesystem locations
  for (const location of compat.locations || []) {
    if (existsSync(location)) {
      return {
        available: true,
        foundIn: location,
        suggestions: [],
      }
    }
  }

  // Not found, provide suggestions
  const suggestions: string[] = []
  const primary = compat.locations?.[0]

  if (backendType === 'claude') {
    suggestions.push(
      `Skills for Claude CLI are loaded from filesystem locations.`,
      `To use skills with Claude CLI backend:`,
      ``,
      `1. Install skills to one of these locations:`,
      `   - Project: ${join(cwd || process.cwd(), '.claude/skills')}`,
      `   - Global:  ${join(homedir(), '.claude/skills')}`,
      ``,
      `2. Or use the SDK backend for Skills tool support:`,
      `   agent-worker session new --backend sdk`
    )
  } else if (backendType === 'codex') {
    suggestions.push(
      `Skills for Codex CLI are loaded from filesystem locations.`,
      `To use skills with Codex CLI backend:`,
      ``,
      `1. Install skills to one of these locations:`,
      `   - Project: ${join(cwd || process.cwd(), '.agents/skills')}`,
      `   - Global:  ${join(homedir(), '.codex/skills')}`,
      `   - Global:  ${join(homedir(), '.agents/skills')}`,
      ``,
      `2. Or use the SDK backend for Skills tool support:`,
      `   agent-worker session new --backend sdk`
    )
  } else if (backendType === 'cursor') {
    suggestions.push(
      `Skills for Cursor CLI are loaded from filesystem locations.`,
      `To use skills with Cursor CLI backend:`,
      ``,
      `1. Install skills to one of these locations:`,
      `   - Project: ${join(cwd || process.cwd(), '.agents/skills')}`,
      `   - Global:  ${join(homedir(), '.agents/skills')}`,
      ``,
      `2. Or use the SDK backend for Skills tool support:`,
      `   agent-worker session new --backend sdk`
    )
  }

  return {
    available: false,
    suggestions,
  }
}

/**
 * Get warning message for --import-skill with CLI backends
 */
export function getImportSkillWarning(backendType: BackendType): string | null {
  if (backendType === 'sdk') {
    return null
  }

  const compat = getSkillsCompatibility(backendType)

  if (compat.method === 'none') {
    return `⚠️  Backend '${backendType}' does not support skills. --import-skill will be ignored.`
  }

  if (compat.method === 'filesystem') {
    return (
      `⚠️  --import-skill is only supported with SDK backend.\n` +
      `   ${backendType} CLI loads skills from filesystem locations.\n` +
      `   To use imported skills, install them manually:\n` +
      `     npx skills add <repo> --global  # Install to ${compat.locations?.[1] || '~/.agents/skills'}\n` +
      `   Or use SDK backend: --backend sdk`
    )
  }

  return null
}
