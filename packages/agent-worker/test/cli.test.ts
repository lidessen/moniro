import { describe, test, expect } from 'bun:test'

// ==================== Instance Utilities Tests ====================

import {
  parseAgentId,
  buildAgentId,
  isValidInstanceName,
  normalizeTarget,
  DEFAULT_INSTANCE,
} from '../src/cli/instance.ts'

describe('parseAgentId', () => {
  test('parses simple agent name', () => {
    const result = parseAgentId('reviewer')
    expect(result.agent).toBe('reviewer')
    expect(result.instance).toBe(DEFAULT_INSTANCE)
    expect(result.full).toBe('reviewer@default')
  })

  test('parses agent@instance format', () => {
    const result = parseAgentId('reviewer@pr-123')
    expect(result.agent).toBe('reviewer')
    expect(result.instance).toBe('pr-123')
    expect(result.full).toBe('reviewer@pr-123')
  })

  test('handles explicit default instance', () => {
    const result = parseAgentId('assistant@default')
    expect(result.agent).toBe('assistant')
    expect(result.instance).toBe('default')
    expect(result.full).toBe('assistant@default')
  })

  test('handles empty instance after @', () => {
    const result = parseAgentId('agent@')
    expect(result.agent).toBe('agent')
    expect(result.instance).toBe(DEFAULT_INSTANCE)
    expect(result.full).toBe('agent@default')
  })

  test('handles multiple @ symbols', () => {
    const result = parseAgentId('agent@instance@extra')
    expect(result.agent).toBe('agent')
    expect(result.instance).toBe('instance@extra')
    expect(result.full).toBe('agent@instance@extra')
  })

  test('handles hyphenated names', () => {
    const result = parseAgentId('code-reviewer@feature-branch')
    expect(result.agent).toBe('code-reviewer')
    expect(result.instance).toBe('feature-branch')
  })

  test('handles underscored names', () => {
    const result = parseAgentId('test_agent@test_instance')
    expect(result.agent).toBe('test_agent')
    expect(result.instance).toBe('test_instance')
  })

  test('handles numeric instance', () => {
    const result = parseAgentId('worker@123')
    expect(result.agent).toBe('worker')
    expect(result.instance).toBe('123')
  })
})

describe('buildAgentId', () => {
  test('builds with explicit instance', () => {
    expect(buildAgentId('agent', 'prod')).toBe('agent@prod')
  })

  test('builds with default instance when undefined', () => {
    expect(buildAgentId('agent', undefined)).toBe('agent@default')
  })

  test('builds with default instance when empty', () => {
    expect(buildAgentId('agent', '')).toBe('agent@default')
  })

  test('preserves special characters in instance', () => {
    expect(buildAgentId('agent', 'pr-123')).toBe('agent@pr-123')
    expect(buildAgentId('agent', 'feature_branch')).toBe('agent@feature_branch')
  })
})

describe('isValidInstanceName', () => {
  test('accepts alphanumeric', () => {
    expect(isValidInstanceName('test123')).toBe(true)
    expect(isValidInstanceName('ABC')).toBe(true)
    expect(isValidInstanceName('123')).toBe(true)
  })

  test('accepts hyphens', () => {
    expect(isValidInstanceName('my-instance')).toBe(true)
    expect(isValidInstanceName('pr-123')).toBe(true)
  })

  test('accepts underscores', () => {
    expect(isValidInstanceName('my_instance')).toBe(true)
    expect(isValidInstanceName('test_123')).toBe(true)
  })

  test('accepts mixed valid characters', () => {
    expect(isValidInstanceName('my-test_instance-123')).toBe(true)
  })

  test('rejects spaces', () => {
    expect(isValidInstanceName('my instance')).toBe(false)
  })

  test('rejects special characters', () => {
    expect(isValidInstanceName('test@instance')).toBe(false)
    expect(isValidInstanceName('test.instance')).toBe(false)
    expect(isValidInstanceName('test/instance')).toBe(false)
    expect(isValidInstanceName('test:instance')).toBe(false)
    expect(isValidInstanceName('test!instance')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(isValidInstanceName('')).toBe(false)
  })
})

describe('normalizeTarget', () => {
  test('returns undefined for undefined', () => {
    expect(normalizeTarget(undefined)).toBeUndefined()
  })

  test('returns undefined for empty string', () => {
    expect(normalizeTarget('')).toBeUndefined()
  })

  test('preserves target with @', () => {
    expect(normalizeTarget('agent@instance')).toBe('agent@instance')
  })

  test('preserves simple name without modification', () => {
    // For backwards compatibility, simple names are not modified
    expect(normalizeTarget('myagent')).toBe('myagent')
  })
})

describe('DEFAULT_INSTANCE', () => {
  test('is "default"', () => {
    expect(DEFAULT_INSTANCE).toBe('default')
  })
})

// ==================== Integration: parseAgentId + buildAgentId ====================

describe('parseAgentId + buildAgentId roundtrip', () => {
  test('roundtrips simple name', () => {
    const id = buildAgentId('agent', 'instance')
    const parsed = parseAgentId(id)
    const rebuilt = buildAgentId(parsed.agent, parsed.instance)
    expect(rebuilt).toBe(id)
  })

  test('roundtrips complex names', () => {
    const testCases = [
      'reviewer@pr-123',
      'code-assistant@feature-branch',
      'worker_1@prod_env',
    ]

    for (const original of testCases) {
      const parsed = parseAgentId(original)
      const rebuilt = buildAgentId(parsed.agent, parsed.instance)
      expect(rebuilt).toBe(original)
    }
  })
})

// ==================== Skills Compatibility Tests ====================

import {
  getSkillsCompatibility,
  checkSkillsAvailability,
  getImportSkillWarning,
} from '../src/cli/skills-compatibility.ts'

describe('getSkillsCompatibility', () => {
  test('SDK backend uses tool method', () => {
    const result = getSkillsCompatibility('sdk')
    expect(result.supported).toBe(true)
    expect(result.method).toBe('tool')
  })

  test('Claude CLI backend uses filesystem method', () => {
    const result = getSkillsCompatibility('claude')
    expect(result.supported).toBe(true)
    expect(result.method).toBe('filesystem')
    expect(result.locations).toBeDefined()
    expect(result.locations!.some(l => l.includes('.claude/skills'))).toBe(true)
  })

  test('Codex CLI backend uses filesystem method', () => {
    const result = getSkillsCompatibility('codex')
    expect(result.supported).toBe(true)
    expect(result.method).toBe('filesystem')
    expect(result.locations).toBeDefined()
    expect(result.locations!.some(l => l.includes('.codex/skills') || l.includes('.agents/skills'))).toBe(true)
  })

  test('Cursor CLI backend uses filesystem method', () => {
    const result = getSkillsCompatibility('cursor')
    expect(result.supported).toBe(true)
    expect(result.method).toBe('filesystem')
    expect(result.locations).toBeDefined()
  })

  test('unknown backend returns unsupported', () => {
    const result = getSkillsCompatibility('unknown' as any)
    expect(result.supported).toBe(false)
    expect(result.method).toBe('none')
    expect(result.warning).toBeDefined()
  })

  test('respects custom cwd for locations', () => {
    const result = getSkillsCompatibility('claude', '/custom/path')
    expect(result.locations!.some(l => l.startsWith('/custom/path'))).toBe(true)
  })
})

describe('checkSkillsAvailability', () => {
  test('SDK backend is always available', () => {
    const result = checkSkillsAvailability('sdk')
    expect(result.available).toBe(true)
    expect(result.suggestions).toHaveLength(0)
  })

  test('unknown backend returns unavailable with suggestions', () => {
    const result = checkSkillsAvailability('unknown' as any)
    expect(result.available).toBe(false)
    expect(result.suggestions.length).toBeGreaterThan(0)
  })

  // Note: filesystem availability depends on actual directories existing
  // These tests just verify the structure, not actual availability
  test('returns suggestions array', () => {
    const result = checkSkillsAvailability('claude')
    // Result depends on whether .claude/skills exists
    expect(Array.isArray(result.suggestions)).toBe(true)
  })
})

describe('getImportSkillWarning', () => {
  test('SDK backend returns null (no warning)', () => {
    expect(getImportSkillWarning('sdk')).toBeNull()
  })

  test('Claude CLI backend returns warning', () => {
    const warning = getImportSkillWarning('claude')
    expect(warning).not.toBeNull()
    expect(warning).toContain('--import-skill')
    expect(warning).toContain('SDK backend')
  })

  test('Codex CLI backend returns warning', () => {
    const warning = getImportSkillWarning('codex')
    expect(warning).not.toBeNull()
    expect(warning).toContain('--import-skill')
  })

  test('Cursor CLI backend returns warning', () => {
    const warning = getImportSkillWarning('cursor')
    expect(warning).not.toBeNull()
    expect(warning).toContain('--import-skill')
  })

  test('unknown backend returns warning about no support', () => {
    const warning = getImportSkillWarning('unknown' as any)
    expect(warning).not.toBeNull()
    expect(warning).toContain('does not support')
  })
})
