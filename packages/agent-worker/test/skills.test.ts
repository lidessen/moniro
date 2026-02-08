import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { accessSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  SkillsProvider,
  createSkillsTool,
  parseImportSpec,
  buildGitUrl,
  getSpecDisplayName,
  SkillImporter,
} from '../src/agent/skills/index.ts'

// Test skill content
const validSkillMd = `---
name: test-skill
description: A test skill for validation
---

# Test Skill

This is a test skill.

## See Also

Check [references/example.md](references/example.md) for details.
`

const invalidSkillMd = `# No Frontmatter

This skill is missing YAML frontmatter.
`

const invalidFrontmatterSkillMd = `---
name: Invalid Name With Spaces
description: Invalid name format
---

# Invalid Skill
`

const exampleReference = `# Example Reference

This is a reference file for progressive disclosure.
`

describe('SkillsProvider', () => {
  let testDir: string

  beforeEach(() => {
    // Create temp directory for test skills
    testDir = join(tmpdir(), `skills-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {}
  })

  describe('addSkill', () => {
    test('adds valid skill', async () => {
      const skillDir = join(testDir, 'test-skill')
      mkdirSync(skillDir)
      writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd)

      const provider = new SkillsProvider()
      await provider.addSkill(skillDir)

      const skills = provider.list()
      expect(skills).toHaveLength(1)
      expect(skills[0]!.name).toBe('test-skill')
      expect(skills[0]!.description).toBe('A test skill for validation')
    })

    test('throws when SKILL.md not found', async () => {
      const skillDir = join(testDir, 'no-skill')
      mkdirSync(skillDir)

      const provider = new SkillsProvider()
      await expect(provider.addSkill(skillDir)).rejects.toThrow('SKILL.md not found')
    })

    test('throws on invalid frontmatter', async () => {
      const skillDir = join(testDir, 'invalid-skill')
      mkdirSync(skillDir)
      writeFileSync(join(skillDir, 'SKILL.md'), invalidSkillMd)

      const provider = new SkillsProvider()
      await expect(provider.addSkill(skillDir)).rejects.toThrow('missing frontmatter')
    })

    test('throws on invalid skill name format', async () => {
      const skillDir = join(testDir, 'invalid-name-skill')
      mkdirSync(skillDir)
      writeFileSync(join(skillDir, 'SKILL.md'), invalidFrontmatterSkillMd)

      const provider = new SkillsProvider()
      await expect(provider.addSkill(skillDir)).rejects.toThrow('Invalid frontmatter')
    })

    test('addSkillSync works synchronously', () => {
      const skillDir = join(testDir, 'sync-skill')
      mkdirSync(skillDir)
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: sync-skill
description: Synchronous test skill
---
# Sync Skill
`
      )

      const provider = new SkillsProvider()
      provider.addSkillSync(skillDir)

      const skills = provider.list()
      expect(skills).toHaveLength(1)
      expect(skills[0]!.name).toBe('sync-skill')
    })
  })

  describe('scanDirectory', () => {
    test('scans directory and finds valid skills', async () => {
      // Create multiple skills
      const skill1Dir = join(testDir, 'skill-one')
      mkdirSync(skill1Dir)
      writeFileSync(
        join(skill1Dir, 'SKILL.md'),
        `---
name: skill-one
description: First skill
---
# Skill One
`
      )

      const skill2Dir = join(testDir, 'skill-two')
      mkdirSync(skill2Dir)
      writeFileSync(
        join(skill2Dir, 'SKILL.md'),
        `---
name: skill-two
description: Second skill
---
# Skill Two
`
      )

      // Create invalid directory (no SKILL.md)
      mkdirSync(join(testDir, 'not-a-skill'))

      const provider = new SkillsProvider()
      await provider.scanDirectory(testDir)

      const skills = provider.list()
      expect(skills).toHaveLength(2)
      expect(skills.map((s) => s.name).sort()).toEqual(['skill-one', 'skill-two'])
    })

    test('ignores non-existent directory', async () => {
      const provider = new SkillsProvider()
      await provider.scanDirectory('/nonexistent/path')

      expect(provider.list()).toHaveLength(0)
    })

    test('scanDirectorySync works synchronously', () => {
      const skillDir = join(testDir, 'sync-scan-skill')
      mkdirSync(skillDir)
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: sync-scan-skill
description: Skill found by sync scan
---
# Sync Scan Skill
`
      )

      const provider = new SkillsProvider()
      provider.scanDirectorySync(testDir)

      const skills = provider.list()
      expect(skills).toHaveLength(1)
      expect(skills[0]!.name).toBe('sync-scan-skill')
    })
  })

  describe('list', () => {
    test('returns empty array when no skills', () => {
      const provider = new SkillsProvider()
      expect(provider.list()).toEqual([])
    })

    test('returns skill metadata', async () => {
      const skillDir = join(testDir, 'metadata-skill')
      mkdirSync(skillDir)
      writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd)

      const provider = new SkillsProvider()
      await provider.addSkill(skillDir)

      const skills = provider.list()
      expect(skills[0]).toEqual({
        name: 'test-skill',
        description: 'A test skill for validation',
      })
    })
  })

  describe('view', () => {
    test('returns full SKILL.md content', async () => {
      const skillDir = join(testDir, 'view-skill')
      mkdirSync(skillDir)
      writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd)

      const provider = new SkillsProvider()
      await provider.addSkill(skillDir)

      const content = await provider.view('test-skill')
      expect(content).toBe(validSkillMd)
    })

    test('throws when skill not found', async () => {
      const provider = new SkillsProvider()
      await expect(provider.view('nonexistent')).rejects.toThrow('Skill "nonexistent" not found')
    })
  })

  describe('readFile', () => {
    test('reads file within skill directory', async () => {
      const skillDir = join(testDir, 'ref-skill')
      const refsDir = join(skillDir, 'references')
      mkdirSync(refsDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd)
      writeFileSync(join(refsDir, 'example.md'), exampleReference)

      const provider = new SkillsProvider()
      await provider.addSkill(skillDir)

      const content = await provider.readFile('test-skill', 'references/example.md')
      expect(content).toBe(exampleReference)
    })

    test('throws when skill not found', async () => {
      const provider = new SkillsProvider()
      await expect(provider.readFile('nonexistent', 'file.md')).rejects.toThrow(
        'Skill "nonexistent" not found'
      )
    })

    test('prevents path traversal with ../', async () => {
      const skillDir = join(testDir, 'secure-skill')
      mkdirSync(skillDir)
      writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd)

      const provider = new SkillsProvider()
      await provider.addSkill(skillDir)

      await expect(provider.readFile('test-skill', '../../../etc/passwd')).rejects.toThrow(
        'Path traversal not allowed'
      )
    })

    test('prevents path traversal with mixed paths', async () => {
      const skillDir = join(testDir, 'secure-skill2')
      mkdirSync(skillDir)
      writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd)

      const provider = new SkillsProvider()
      await provider.addSkill(skillDir)

      // Various traversal attempts
      await expect(provider.readFile('test-skill', 'references/../../../etc/passwd')).rejects.toThrow(
        'Path traversal not allowed'
      )
      await expect(provider.readFile('test-skill', 'references/../../secret.txt')).rejects.toThrow(
        'Path traversal not allowed'
      )
      await expect(provider.readFile('test-skill', '../secret.txt')).rejects.toThrow(
        'Path traversal not allowed'
      )
    })

    test('absolute paths are safely contained', async () => {
      const skillDir = join(testDir, 'secure-skill3')
      mkdirSync(skillDir)
      writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd)

      const provider = new SkillsProvider()
      await provider.addSkill(skillDir)

      // Absolute paths are treated as relative (safe behavior)
      await expect(provider.readFile('test-skill', '/etc/passwd')).rejects.toThrow()
      await expect(provider.readFile('test-skill', '/absolute/path')).rejects.toThrow()
    })

    test('reads scripts and assets', async () => {
      const skillDir = join(testDir, 'full-skill')
      const scriptsDir = join(skillDir, 'scripts')
      const assetsDir = join(skillDir, 'assets')
      mkdirSync(scriptsDir, { recursive: true })
      mkdirSync(assetsDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd)
      writeFileSync(join(scriptsDir, 'run.sh'), '#!/bin/bash\necho "test"')
      writeFileSync(join(assetsDir, 'template.txt'), 'Template content')

      const provider = new SkillsProvider()
      await provider.addSkill(skillDir)

      const scriptContent = await provider.readFile('test-skill', 'scripts/run.sh')
      expect(scriptContent).toContain('#!/bin/bash')

      const assetContent = await provider.readFile('test-skill', 'assets/template.txt')
      expect(assetContent).toBe('Template content')
    })
  })
})

describe('createSkillsTool', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-tool-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {}
  })

  test('creates valid AI SDK tool', () => {
    const provider = new SkillsProvider()
    const skillsTool = createSkillsTool(provider) as any

    expect(skillsTool.description).toContain('agent skills')
    expect(skillsTool.execute).toBeDefined()
  })

  test('list operation returns skills', async () => {
    const skillDir = join(testDir, 'list-skill')
    mkdirSync(skillDir)
    writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd)

    const provider = new SkillsProvider()
    await provider.addSkill(skillDir)

    const tool = createSkillsTool(provider)
    const result = (await tool.execute!({ operation: 'list' })) as {
      skills: Array<{ name: string; description: string }>
    }

    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]!.name).toBe('test-skill')
  })

  test('list operation with no skills', async () => {
    const provider = new SkillsProvider()
    const tool = createSkillsTool(provider)

    const result = (await tool.execute!({ operation: 'list' })) as { message: string }
    expect(result.message).toBe('No skills available')
  })

  test('view operation returns skill content', async () => {
    const skillDir = join(testDir, 'view-tool-skill')
    mkdirSync(skillDir)
    writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd)

    const provider = new SkillsProvider()
    await provider.addSkill(skillDir)

    const tool = createSkillsTool(provider)
    const result = (await tool.execute!({
      operation: 'view',
      skillName: 'test-skill',
    })) as { content: string }

    expect(result.content).toBe(validSkillMd)
  })

  test('view operation throws without skillName', async () => {
    const provider = new SkillsProvider()
    const tool = createSkillsTool(provider)

    await expect(tool.execute!({ operation: 'view' })).rejects.toThrow(
      'skillName is required for view operation'
    )
  })

  test('readFile operation returns file content', async () => {
    const skillDir = join(testDir, 'readfile-tool-skill')
    const refsDir = join(skillDir, 'references')
    mkdirSync(refsDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd)
    writeFileSync(join(refsDir, 'example.md'), exampleReference)

    const provider = new SkillsProvider()
    await provider.addSkill(skillDir)

    const tool = createSkillsTool(provider)
    const result = (await tool.execute!({
      operation: 'readFile',
      skillName: 'test-skill',
      filePath: 'references/example.md',
    })) as { content: string }

    expect(result.content).toBe(exampleReference)
  })

  test('readFile operation throws without required params', async () => {
    const provider = new SkillsProvider()
    const tool = createSkillsTool(provider)

    await expect(tool.execute!({ operation: 'readFile' })).rejects.toThrow(
      'skillName and filePath are required'
    )

    await expect(
      tool.execute!({ operation: 'readFile', skillName: 'test' })
    ).rejects.toThrow('skillName and filePath are required')
  })

  test('throws on unknown operation', async () => {
    const provider = new SkillsProvider()
    const tool = createSkillsTool(provider)

    await expect(tool.execute!({ operation: 'invalid' })).rejects.toThrow(
      'Unknown operation: invalid'
    )
  })
})

describe('Skills integration', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-integration-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {}
  })

  test('works with AgentSession', async () => {
    const { AgentSession } = await import('../src/agent/session.ts')

    const skillDir = join(testDir, 'session-skill')
    mkdirSync(skillDir)
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: session-skill
description: Skill for session testing
---
# Session Skill
`
    )

    const provider = new SkillsProvider()
    await provider.addSkill(skillDir)

    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'You are a helpful assistant.',
      tools: { Skills: createSkillsTool(provider) as any },
    })

    expect(session.id).toBeDefined()
    const tools = session.getTools()
    expect(tools.map((t) => t.name)).toContain('Skills')
  })

  test('full progressive disclosure workflow', async () => {
    // Create skill with main content and references
    const skillDir = join(testDir, 'pd-skill')
    const refsDir = join(skillDir, 'references')
    mkdirSync(refsDir, { recursive: true })

    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: progressive-skill
description: Progressive disclosure example
---

# Progressive Skill

Main content goes here.

For details, see [references/advanced.md](references/advanced.md)
`
    )

    writeFileSync(join(refsDir, 'advanced.md'), '# Advanced Topics\n\nDetailed content.')

    const provider = new SkillsProvider()
    await provider.addSkill(skillDir)
    const tool = createSkillsTool(provider)

    // Step 1: List skills
    const listResult = (await tool.execute!({ operation: 'list' })) as {
      skills: Array<{ name: string; description: string }>
    }
    expect(listResult.skills[0]!.name).toBe('progressive-skill')

    // Step 2: View main skill
    const viewResult = (await tool.execute!({
      operation: 'view',
      skillName: 'progressive-skill',
    })) as { content: string }
    expect(viewResult.content).toContain('Main content goes here')

    // Step 3: Load reference on demand
    const refResult = (await tool.execute!({
      operation: 'readFile',
      skillName: 'progressive-skill',
      filePath: 'references/advanced.md',
    })) as { content: string }
    expect(refResult.content).toContain('Advanced Topics')
  })
})

// ==================== Import Spec Tests ====================

describe('parseImportSpec', () => {
  test('parses minimal spec (owner/repo)', () => {
    const spec = parseImportSpec('vercel-labs/agent-skills')
    expect(spec.provider).toBe('github')
    expect(spec.owner).toBe('vercel-labs')
    expect(spec.repo).toBe('agent-skills')
    expect(spec.ref).toBe('main')
    expect(spec.skills).toBe('all')
    expect(spec.rawSpec).toBe('vercel-labs/agent-skills')
  })

  test('parses with single skill', () => {
    const spec = parseImportSpec('vercel-labs/agent-skills:react')
    expect(spec.skills).toEqual(['react'])
  })

  test('parses with multiple skills (brace expansion)', () => {
    const spec = parseImportSpec('vercel-labs/agent-skills:{react,web,nextjs}')
    expect(spec.skills).toEqual(['react', 'web', 'nextjs'])
  })

  test('parses with ref', () => {
    const spec = parseImportSpec('vercel-labs/agent-skills@v1.0.0:react')
    expect(spec.ref).toBe('v1.0.0')
    expect(spec.skills).toEqual(['react'])
  })

  test('parses with provider', () => {
    const spec = parseImportSpec('gitlab:myorg/myrepo:skill1')
    expect(spec.provider).toBe('gitlab')
    expect(spec.owner).toBe('myorg')
    expect(spec.repo).toBe('myrepo')
  })

  test('parses gitee provider', () => {
    const spec = parseImportSpec('gitee:org/repo@main:{a,b}')
    expect(spec.provider).toBe('gitee')
    expect(spec.ref).toBe('main')
    expect(spec.skills).toEqual(['a', 'b'])
  })

  test('throws on invalid format', () => {
    expect(() => parseImportSpec('invalid')).toThrow('Invalid import spec')
    expect(() => parseImportSpec('no-slash')).toThrow('Invalid import spec')
    expect(() => parseImportSpec('/no-owner/repo')).toThrow('Invalid import spec')
  })

  test('throws on unsupported provider', () => {
    expect(() => parseImportSpec('bitbucket:owner/repo')).toThrow(
      'Unsupported provider'
    )
  })

  test('throws on empty skill list in braces', () => {
    expect(() => parseImportSpec('owner/repo:{}')).toThrow(
      'Empty skill list in braces'
    )
  })

  test('handles whitespace in skill lists', () => {
    const spec = parseImportSpec('owner/repo:{ a , b , c }')
    expect(spec.skills).toEqual(['a', 'b', 'c'])
  })

  // Security tests: prevent git argument injection
  test('rejects owner starting with hyphen', () => {
    expect(() => parseImportSpec('--upload-pack=evil/repo')).toThrow('Invalid owner')
  })

  test('rejects repo starting with hyphen', () => {
    expect(() => parseImportSpec('owner/--config=evil')).toThrow('Invalid repo')
  })

  test('rejects ref starting with hyphen', () => {
    expect(() => parseImportSpec('owner/repo@--upload-pack=evil')).toThrow('Invalid ref')
  })

  test('rejects owner with shell metacharacters', () => {
    expect(() => parseImportSpec('owner;whoami/repo')).toThrow('Invalid owner')
    expect(() => parseImportSpec('owner$(cmd)/repo')).toThrow('Invalid owner')
    expect(() => parseImportSpec('owner`cmd`/repo')).toThrow('Invalid owner')
  })

  test('rejects repo with shell metacharacters', () => {
    expect(() => parseImportSpec('owner/repo;whoami')).toThrow('Invalid repo')
    expect(() => parseImportSpec('owner/repo&&cmd')).toThrow('Invalid repo')
    expect(() => parseImportSpec('owner/repo|cat')).toThrow('Invalid repo') // Validation catches it
  })

  test('rejects ref with shell metacharacters', () => {
    expect(() => parseImportSpec('owner/repo@v1.0;evil')).toThrow('Invalid ref')
  })

  test('rejects names with spaces', () => {
    expect(() => parseImportSpec('owner with spaces/repo')).toThrow('Invalid owner')
    expect(() => parseImportSpec('owner/repo with spaces')).toThrow('Invalid repo')
  })

  test('rejects names with quotes', () => {
    expect(() => parseImportSpec('owner/"repo"')).toThrow('Invalid repo')
    expect(() => parseImportSpec("owner/'repo'")).toThrow('Invalid repo')
  })

  test('rejects names with newlines', () => {
    expect(() => parseImportSpec('owner/repo\nmalicious')).toThrow('Invalid repo')
  })

  test('rejects names with null bytes', () => {
    expect(() => parseImportSpec('owner/repo\x00')).toThrow('Invalid repo')
  })

  test('accepts valid names with hyphens, underscores, dots', () => {
    const spec1 = parseImportSpec('my-org/my-repo')
    expect(spec1.owner).toBe('my-org')
    expect(spec1.repo).toBe('my-repo')

    const spec2 = parseImportSpec('my_org/my_repo.js')
    expect(spec2.owner).toBe('my_org')
    expect(spec2.repo).toBe('my_repo.js')

    const spec3 = parseImportSpec('org123/repo456@v1.2.3')
    expect(spec3.ref).toBe('v1.2.3')
  })
})

describe('buildGitUrl', () => {
  test('builds GitHub URL', () => {
    const spec = parseImportSpec('vercel-labs/agent-skills')
    const url = buildGitUrl(spec)
    expect(url).toBe('https://github.com/vercel-labs/agent-skills.git')
  })

  test('builds GitLab URL', () => {
    const spec = parseImportSpec('gitlab:myorg/myrepo')
    const url = buildGitUrl(spec)
    expect(url).toBe('https://gitlab.com/myorg/myrepo.git')
  })

  test('builds Gitee URL', () => {
    const spec = parseImportSpec('gitee:org/repo')
    const url = buildGitUrl(spec)
    expect(url).toBe('https://gitee.com/org/repo.git')
  })
})

describe('getSpecDisplayName', () => {
  test('displays "all skills" when skills is "all"', () => {
    const spec = parseImportSpec('owner/repo')
    const name = getSpecDisplayName(spec)
    expect(name).toBe('owner/repo@main (all skills)')
  })

  test('displays single skill name', () => {
    const spec = parseImportSpec('owner/repo:react')
    const name = getSpecDisplayName(spec)
    expect(name).toBe('owner/repo@main (react)')
  })

  test('displays skill count for multiple skills', () => {
    const spec = parseImportSpec('owner/repo:{a,b,c}')
    const name = getSpecDisplayName(spec)
    expect(name).toBe('owner/repo@main (3 skills)')
  })
})

// ==================== SkillImporter Tests ====================

describe('SkillImporter', () => {
  let importer: SkillImporter
  let sessionId: string

  beforeEach(() => {
    sessionId = `test-${Date.now()}`
    importer = new SkillImporter(sessionId)
  })

  afterEach(async () => {
    await importer.cleanup()
  })

  test('creates temp directory with session ID', () => {
    const tempDir = importer.getTempDir()
    expect(tempDir).toContain(`agent-worker-skills-${sessionId}`)
  })

  test('cleanup removes temp directory', async () => {
    const tempDir = importer.getTempDir()

    // Create temp dir to simulate import
    mkdirSync(tempDir, { recursive: true })
    writeFileSync(join(tempDir, 'test.txt'), 'test')

    await importer.cleanup()

    // Verify it's gone
    expect(() => accessSync(tempDir)).toThrow()
  })

  test('getImportedSkills returns empty array initially', () => {
    expect(importer.getImportedSkills()).toEqual([])
  })

  test('getAllImportedSkillPaths returns empty array initially', () => {
    expect(importer.getAllImportedSkillPaths()).toEqual([])
  })

  test('getImportedSkillPath returns null for unknown skill', () => {
    expect(importer.getImportedSkillPath('unknown')).toBeNull()
  })

  test('importMultiple handles multiple specs', async () => {
    // Mock the import method to avoid actual git clones
    const originalImport = importer.import.bind(importer)
    let importCalls = 0

    importer.import = async (spec: string) => {
      importCalls++
      // Simulate failure for one spec
      if (spec.includes('failing')) {
        throw new Error('Git clone failed')
      }
      return []
    }

    const specs = ['owner/repo1:skill1', 'owner/failing:skill2', 'owner/repo3:skill3']
    const result = await importer.importMultiple(specs)

    // Should continue after error
    expect(importCalls).toBe(3)
    expect(result).toEqual([])

    // Restore original method
    importer.import = originalImport
  })

  test('cleanup is safe when temp dir does not exist', async () => {
    // Should not throw when cleaning up non-existent directory
    await expect(importer.cleanup()).resolves.toBeUndefined()
  })

  test('cleanup can be called multiple times', async () => {
    const tempDir = importer.getTempDir()
    mkdirSync(tempDir, { recursive: true })

    await importer.cleanup()
    await importer.cleanup() // Should not throw

    // Still cleaned up
    expect(() => accessSync(tempDir)).toThrow()
  })

  test('getImportedSkills returns imported skill metadata', () => {
    // Manually set an imported skill to test getters
    const mockSkill = {
      name: 'test-skill',
      source: 'owner/repo:test-skill',
      tempPath: '/tmp/test-skill',
    }

    // Access private property for testing
    ;(importer as any).imported.set('test-skill', mockSkill)

    const skills = importer.getImportedSkills()
    expect(skills).toHaveLength(1)
    expect(skills[0]).toEqual(mockSkill)

    const path = importer.getImportedSkillPath('test-skill')
    expect(path).toBe('/tmp/test-skill')

    const paths = importer.getAllImportedSkillPaths()
    expect(paths).toEqual(['/tmp/test-skill'])
  })

  // Note: Full integration test with actual git clone would require network
  // and is better suited for e2e tests. Unit tests focus on the API surface.
})

// ==================== Integration with SkillsProvider ====================

describe('SkillsProvider with imported skills', () => {
  let testDir: string
  let provider: SkillsProvider

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-import-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    provider = new SkillsProvider()
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('addImportedSkills loads skills from importer paths', async () => {
    // Create a mock skill
    const skillDir = join(testDir, 'test-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: test-skill\ndescription: Test\n---\n\n# Test`
    )

    // Create a mock importer-like object
    const mockImporter = {
      getAllImportedSkillPaths: () => [skillDir],
    }

    await provider.addImportedSkills(mockImporter)

    const skills = provider.list()
    expect(skills).toHaveLength(1)
    expect(skills[0]!.name).toBe('test-skill')
  })

  test('addImportedSkillsSync loads skills synchronously', () => {
    // Create a mock skill
    const skillDir = join(testDir, 'sync-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: sync-skill\ndescription: Sync test\n---\n\n# Sync`
    )

    // Create a mock importer-like object
    const mockImporter = {
      getAllImportedSkillPaths: () => [skillDir],
    }

    provider.addImportedSkillsSync(mockImporter)

    const skills = provider.list()
    expect(skills).toHaveLength(1)
    expect(skills[0]!.name).toBe('sync-skill')
  })
})
