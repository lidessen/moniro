import { describe, test, expect } from 'bun:test'

// ==================== Target Utilities Tests ====================
// Tests for the new workflow:tag model

import {
  parseTarget,
  buildTarget,
  buildTargetDisplay,
  isValidName,
  DEFAULT_WORKFLOW,
  DEFAULT_TAG,
} from '../src/cli/target.ts'

describe('parseTarget', () => {
  describe('agent-only targets', () => {
    test('parses simple agent name', () => {
      const result = parseTarget('alice')
      expect(result.agent).toBe('alice')
      expect(result.workflow).toBe('global')
      expect(result.tag).toBe('main')
      expect(result.full).toBe('alice@global:main')
      expect(result.display).toBe('alice') // Omits @global:main
    })

    test('parses agent@workflow', () => {
      const result = parseTarget('alice@review')
      expect(result.agent).toBe('alice')
      expect(result.workflow).toBe('review')
      expect(result.tag).toBe('main')
      expect(result.full).toBe('alice@review:main')
      expect(result.display).toBe('alice@review') // Omits :main
    })

    test('parses agent@workflow:tag (full format)', () => {
      const result = parseTarget('alice@review:pr-123')
      expect(result.agent).toBe('alice')
      expect(result.workflow).toBe('review')
      expect(result.tag).toBe('pr-123')
      expect(result.full).toBe('alice@review:pr-123')
      expect(result.display).toBe('alice@review:pr-123')
    })

    test('handles empty workflow after @', () => {
      const result = parseTarget('alice@')
      expect(result.agent).toBe('alice')
      expect(result.workflow).toBe('global')
      expect(result.tag).toBe('main')
    })

    test('handles empty tag after :', () => {
      const result = parseTarget('alice@review:')
      expect(result.agent).toBe('alice')
      expect(result.workflow).toBe('review')
      expect(result.tag).toBe('main')
    })
  })

  describe('workflow-only targets', () => {
    test('parses @workflow', () => {
      const result = parseTarget('@review')
      expect(result.agent).toBeUndefined()
      expect(result.workflow).toBe('review')
      expect(result.tag).toBe('main')
      expect(result.full).toBe('@review:main')
      expect(result.display).toBe('@review') // Omits :main
    })

    test('parses @workflow:tag', () => {
      const result = parseTarget('@review:pr-123')
      expect(result.agent).toBeUndefined()
      expect(result.workflow).toBe('review')
      expect(result.tag).toBe('pr-123')
      expect(result.full).toBe('@review:pr-123')
      expect(result.display).toBe('@review:pr-123')
    })

    test('parses @global (explicit default)', () => {
      const result = parseTarget('@global')
      expect(result.agent).toBeUndefined()
      expect(result.workflow).toBe('global')
      expect(result.tag).toBe('main')
      expect(result.full).toBe('@global:main')
      expect(result.display).toBe('@global')
    })

    test('handles empty workflow after @ (defaults to global)', () => {
      const result = parseTarget('@')
      expect(result.workflow).toBe('global')
      expect(result.tag).toBe('main')
    })
  })

  describe('special characters', () => {
    test('handles hyphenated names', () => {
      const result = parseTarget('code-reviewer@feature-branch:pr-123')
      expect(result.agent).toBe('code-reviewer')
      expect(result.workflow).toBe('feature-branch')
      expect(result.tag).toBe('pr-123')
    })

    test('handles underscored names', () => {
      const result = parseTarget('test_agent@test_workflow:test_tag')
      expect(result.agent).toBe('test_agent')
      expect(result.workflow).toBe('test_workflow')
      expect(result.tag).toBe('test_tag')
    })

    test('handles numeric names', () => {
      const result = parseTarget('agent1@workflow2:tag3')
      expect(result.agent).toBe('agent1')
      expect(result.workflow).toBe('workflow2')
      expect(result.tag).toBe('tag3')
    })

    test('handles dots in names', () => {
      const result = parseTarget('alice@v1.2.3:release-1.0')
      expect(result.agent).toBe('alice')
      expect(result.workflow).toBe('v1.2.3')
      expect(result.tag).toBe('release-1.0')
    })
  })

  describe('edge cases', () => {
    test('handles multiple @ symbols (takes first as separator)', () => {
      const result = parseTarget('agent@work@flow')
      expect(result.agent).toBe('agent')
      expect(result.workflow).toBe('work@flow') // Rest becomes workflow
      expect(result.tag).toBe('main')
    })

    test('handles multiple : symbols (takes first as separator)', () => {
      const result = parseTarget('agent@workflow:tag:extra')
      expect(result.agent).toBe('agent')
      expect(result.workflow).toBe('workflow')
      expect(result.tag).toBe('tag:extra') // Rest becomes tag
    })
  })
})

describe('buildTarget', () => {
  test('builds full target with all parts', () => {
    expect(buildTarget('alice', 'review', 'pr-123')).toBe('alice@review:pr-123')
  })

  test('uses default workflow when undefined', () => {
    expect(buildTarget('alice', undefined, 'pr-123')).toBe('alice@global:pr-123')
  })

  test('uses default tag when undefined', () => {
    expect(buildTarget('alice', 'review', undefined)).toBe('alice@review:main')
  })

  test('uses both defaults when undefined', () => {
    expect(buildTarget('alice')).toBe('alice@global:main')
  })

  test('builds workflow-only target (no agent)', () => {
    expect(buildTarget(undefined, 'review', 'pr-123')).toBe('@review:pr-123')
  })

  test('builds workflow-only with defaults', () => {
    expect(buildTarget(undefined, 'review')).toBe('@review:main')
  })

  test('uses empty string as default', () => {
    expect(buildTarget('alice', '', '')).toBe('alice@global:main')
  })
})

describe('buildTargetDisplay', () => {
  describe('display rules - omit @global', () => {
    test('standalone agent (global:main) shows just name', () => {
      expect(buildTargetDisplay('alice', 'global', 'main')).toBe('alice')
    })

    test('global workflow with non-main tag shows workflow:tag', () => {
      expect(buildTargetDisplay('alice', 'global', 'pr-123')).toBe('alice@global:pr-123')
    })
  })

  describe('display rules - omit :main', () => {
    test('non-global workflow with main tag omits tag', () => {
      expect(buildTargetDisplay('alice', 'review', 'main')).toBe('alice@review')
    })

    test('non-global workflow with non-main tag shows all', () => {
      expect(buildTargetDisplay('alice', 'review', 'pr-123')).toBe('alice@review:pr-123')
    })
  })

  describe('workflow-only targets', () => {
    test('@global shows @global', () => {
      expect(buildTargetDisplay(undefined, 'global', 'main')).toBe('@global')
    })

    test('@global:tag shows @global:tag', () => {
      expect(buildTargetDisplay(undefined, 'global', 'pr-123')).toBe('@global:pr-123')
    })

    test('@workflow shows @workflow', () => {
      expect(buildTargetDisplay(undefined, 'review', 'main')).toBe('@review')
    })

    test('@workflow:tag shows @workflow:tag', () => {
      expect(buildTargetDisplay(undefined, 'review', 'pr-123')).toBe('@review:pr-123')
    })
  })

  describe('uses defaults', () => {
    test('undefined workflow defaults to global', () => {
      expect(buildTargetDisplay('alice', undefined, 'main')).toBe('alice')
    })

    test('undefined tag defaults to main', () => {
      expect(buildTargetDisplay('alice', 'review', undefined)).toBe('alice@review')
    })

    test('both undefined defaults to alice', () => {
      expect(buildTargetDisplay('alice')).toBe('alice')
    })
  })
})

describe('isValidName', () => {
  test('accepts alphanumeric', () => {
    expect(isValidName('test123')).toBe(true)
    expect(isValidName('ABC')).toBe(true)
    expect(isValidName('123')).toBe(true)
  })

  test('accepts hyphens', () => {
    expect(isValidName('my-workflow')).toBe(true)
    expect(isValidName('pr-123')).toBe(true)
  })

  test('accepts underscores', () => {
    expect(isValidName('my_workflow')).toBe(true)
    expect(isValidName('test_123')).toBe(true)
  })

  test('accepts dots', () => {
    expect(isValidName('v1.2.3')).toBe(true)
    expect(isValidName('workflow.name')).toBe(true)
  })

  test('accepts mixed valid characters', () => {
    expect(isValidName('my-test_workflow.v1')).toBe(true)
  })

  test('rejects spaces', () => {
    expect(isValidName('my workflow')).toBe(false)
  })

  test('rejects special characters', () => {
    expect(isValidName('test@workflow')).toBe(false)
    expect(isValidName('test/workflow')).toBe(false)
    expect(isValidName('test:workflow')).toBe(false)
    expect(isValidName('test!workflow')).toBe(false)
    expect(isValidName('test#workflow')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(isValidName('')).toBe(false)
  })
})

describe('DEFAULT constants', () => {
  test('DEFAULT_WORKFLOW is "global"', () => {
    expect(DEFAULT_WORKFLOW).toBe('global')
  })

  test('DEFAULT_TAG is "main"', () => {
    expect(DEFAULT_TAG).toBe('main')
  })
})

describe('parseTarget + buildTarget roundtrip', () => {
  test('roundtrips full target', () => {
    const original = 'alice@review:pr-123'
    const parsed = parseTarget(original)
    const rebuilt = buildTarget(parsed.agent, parsed.workflow, parsed.tag)
    expect(rebuilt).toBe('alice@review:pr-123')
  })

  test('roundtrips workflow-only target', () => {
    const original = '@review:pr-123'
    const parsed = parseTarget(original)
    const rebuilt = buildTarget(parsed.agent, parsed.workflow, parsed.tag)
    expect(rebuilt).toBe('@review:pr-123')
  })

  test('roundtrips simple agent (adds defaults)', () => {
    const original = 'alice'
    const parsed = parseTarget(original)
    const rebuilt = buildTarget(parsed.agent, parsed.workflow, parsed.tag)
    expect(rebuilt).toBe('alice@global:main')
  })

  test('display uses original input when possible', () => {
    const cases = [
      { input: 'alice', expectedDisplay: 'alice' },
      { input: 'alice@review', expectedDisplay: 'alice@review' },
      { input: 'alice@review:pr-123', expectedDisplay: 'alice@review:pr-123' },
      { input: '@review', expectedDisplay: '@review' },
      { input: '@review:pr-123', expectedDisplay: '@review:pr-123' },
    ]

    for (const { input, expectedDisplay } of cases) {
      const parsed = parseTarget(input)
      expect(parsed.display).toBe(expectedDisplay)
    }
  })
})
