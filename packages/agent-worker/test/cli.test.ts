import { describe, test, expect } from 'bun:test'

// ==================== Instance Utilities Tests (Backward Compat) ====================
// These test deprecated APIs for backward compatibility

import {
  parseAgentId,
  buildAgentId,
  isValidInstanceName,
  DEFAULT_INSTANCE,
} from '../src/cli/instance.ts'

describe('parseAgentId (backward compat)', () => {
  test('parses simple agent name', () => {
    const result = parseAgentId('reviewer')
    expect(result.agent).toBe('reviewer')
    expect(result.instance).toBe('global') // Maps to DEFAULT_WORKFLOW
    expect(result.full).toBe('reviewer@global') // No tag in backward compat
  })

  test('parses agent@instance format', () => {
    const result = parseAgentId('reviewer@pr-123')
    expect(result.agent).toBe('reviewer')
    expect(result.instance).toBe('pr-123') // Instance maps to workflow
    expect(result.full).toBe('reviewer@pr-123')
  })

  test('handles explicit global instance', () => {
    const result = parseAgentId('assistant@global')
    expect(result.agent).toBe('assistant')
    expect(result.instance).toBe('global')
    expect(result.full).toBe('assistant@global')
  })

  test('handles empty instance after @', () => {
    const result = parseAgentId('agent@')
    expect(result.agent).toBe('agent')
    expect(result.instance).toBe('global')
    expect(result.full).toBe('agent@global')
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

describe('buildAgentId (backward compat)', () => {
  test('builds with explicit instance (includes tag)', () => {
    // buildAgentId now calls buildTarget which includes tag
    expect(buildAgentId('agent', 'prod')).toBe('agent@prod:main')
  })

  test('builds with default instance when undefined', () => {
    expect(buildAgentId('agent', undefined)).toBe('agent@global:main')
  })

  test('builds with default instance when empty', () => {
    expect(buildAgentId('agent', '')).toBe('agent@global:main')
  })

  test('preserves special characters in instance', () => {
    expect(buildAgentId('agent', 'pr-123')).toBe('agent@pr-123:main')
    expect(buildAgentId('agent', 'feature_branch')).toBe('agent@feature_branch:main')
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

  test('accepts dots', () => {
    expect(isValidInstanceName('test.instance')).toBe(true)
    expect(isValidInstanceName('v1.2.3')).toBe(true)
  })

  test('accepts mixed valid characters', () => {
    expect(isValidInstanceName('my-test_instance-123')).toBe(true)
  })

  test('rejects spaces', () => {
    expect(isValidInstanceName('my instance')).toBe(false)
  })

  test('rejects special characters', () => {
    expect(isValidInstanceName('test@instance')).toBe(false)
    expect(isValidInstanceName('test/instance')).toBe(false)
    expect(isValidInstanceName('test:instance')).toBe(false)
    expect(isValidInstanceName('test!instance')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(isValidInstanceName('')).toBe(false)
  })
})

describe('DEFAULT_INSTANCE', () => {
  test('is "global" (maps to DEFAULT_WORKFLOW)', () => {
    expect(DEFAULT_INSTANCE).toBe('global')
  })
})

// ==================== Integration: parseAgentId + buildAgentId ====================
// Note: These don't roundtrip perfectly due to tag inclusion in buildAgentId

describe('parseAgentId + buildAgentId', () => {
  test('parseAgentId extracts workflow part', () => {
    const parsed = parseAgentId('agent@prod')
    expect(parsed.instance).toBe('prod')
    expect(parsed.full).toBe('agent@prod')
  })

  test('buildAgentId includes tag', () => {
    const built = buildAgentId('agent', 'prod')
    expect(built).toBe('agent@prod:main') // Includes :main tag
  })

  test('parsing built IDs extracts workflow part', () => {
    // Build with instance -> parse -> extract instance
    const built = buildAgentId('agent', 'instance')
    expect(built).toBe('agent@instance:main') // Includes tag

    const parsed = parseAgentId(built) // Parses "agent@instance:main"
    expect(parsed.agent).toBe('agent')
    // parseAgentId extracts workflow part only (not tag)
    expect(parsed.instance).toBe('instance')
    expect(parsed.full).toBe('agent@instance') // No tag in backward compat format
  })
})
