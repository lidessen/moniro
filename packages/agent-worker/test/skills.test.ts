import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SkillsProvider, createSkillsTool } from '../src/skills/index.ts'

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
      expect(skills[0].name).toBe('test-skill')
      expect(skills[0].description).toBe('A test skill for validation')
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
      expect(skills[0].name).toBe('sync-skill')
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
      expect(skills[0].name).toBe('sync-scan-skill')
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

    test('prevents path traversal', async () => {
      const skillDir = join(testDir, 'secure-skill')
      mkdirSync(skillDir)
      writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd)

      const provider = new SkillsProvider()
      await provider.addSkill(skillDir)

      await expect(provider.readFile('test-skill', '../../../etc/passwd')).rejects.toThrow(
        'Path traversal not allowed'
      )
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

  test('creates valid tool definition', () => {
    const provider = new SkillsProvider()
    const tool = createSkillsTool(provider)

    expect(tool.name).toBe('Skills')
    expect(tool.description).toContain('agent skills')
    expect(tool.parameters.type).toBe('object')
    expect(tool.parameters.properties.operation).toBeDefined()
    expect(tool.execute).toBeDefined()
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
    expect(result.skills[0].name).toBe('test-skill')
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
    const { AgentSession } = await import('../src/session.ts')

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
      tools: [createSkillsTool(provider)],
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
    expect(listResult.skills[0].name).toBe('progressive-skill')

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
