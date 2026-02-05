import { readFile, readdir, stat } from 'node:fs/promises'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

const frontmatterSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(64),
  description: z.string().min(1).max(1024),
  license: z.string().optional(),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string()).optional(),
  'allowed-tools': z.string().optional(),
})

export interface SkillMetadata {
  name: string
  description: string
  path: string
}

export class SkillsProvider {
  private skills = new Map<string, SkillMetadata>()

  /**
   * Add a single skill directory
   */
  async addSkill(skillPath: string): Promise<void> {
    const skillMdPath = join(skillPath, 'SKILL.md')

    try {
      await stat(skillMdPath)
    } catch {
      throw new Error(`SKILL.md not found in ${skillPath}`)
    }

    const frontmatter = await this.parseFrontmatter(skillMdPath)
    this.skills.set(frontmatter.name, {
      name: frontmatter.name,
      description: frontmatter.description,
      path: skillPath,
    })
  }

  /**
   * Scan a directory and add all valid skills found
   */
  async scanDirectory(dir: string): Promise<void> {
    const resolved = this.resolvePath(dir)

    try {
      const entries = await readdir(resolved, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = join(resolved, entry.name)
          try {
            await this.addSkill(skillPath)
          } catch {
            // Not a valid skill, skip
          }
        }
      }
    } catch {
      // Directory doesn't exist, ignore
    }
  }

  /**
   * List all available skills (metadata only)
   */
  list(): Array<{ name: string; description: string }> {
    return Array.from(this.skills.values()).map(({ name, description }) => ({
      name,
      description,
    }))
  }

  /**
   * View the full SKILL.md content
   */
  async view(skillName: string): Promise<string> {
    const skill = this.skills.get(skillName)
    if (!skill) {
      throw new Error(`Skill "${skillName}" not found`)
    }

    const skillMdPath = join(skill.path, 'SKILL.md')
    return await readFile(skillMdPath, 'utf-8')
  }

  /**
   * Read a file within a skill directory (relative path)
   */
  async readFile(skillName: string, relativePath: string): Promise<string> {
    const skill = this.skills.get(skillName)
    if (!skill) {
      throw new Error(`Skill "${skillName}" not found`)
    }

    // Security: prevent path traversal
    const normalized = normalize(relativePath)
    if (normalized.startsWith('..')) {
      throw new Error('Path traversal not allowed')
    }

    const filePath = join(skill.path, normalized)
    return await readFile(filePath, 'utf-8')
  }

  /**
   * Parse YAML frontmatter from SKILL.md
   */
  private async parseFrontmatter(skillMdPath: string): Promise<
    z.infer<typeof frontmatterSchema>
  > {
    const content = await readFile(skillMdPath, 'utf-8')
    const match = content.match(/^---\n([\s\S]+?)\n---/)

    if (!match) {
      throw new Error(`Invalid SKILL.md: missing frontmatter in ${skillMdPath}`)
    }

    try {
      return frontmatterSchema.parse(parseYaml(match[1]))
    } catch (error) {
      throw new Error(
        `Invalid frontmatter in ${skillMdPath}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Resolve tilde and relative paths
   */
  private resolvePath(path: string): string {
    if (path.startsWith('~/')) {
      const home = process.env.HOME || process.env.USERPROFILE
      if (!home) {
        throw new Error('Cannot resolve ~/ without HOME environment variable')
      }
      return join(home, path.slice(2))
    }
    return path
  }

  /**
   * Synchronous version: Add a single skill directory
   */
  addSkillSync(skillPath: string): void {
    const skillMdPath = join(skillPath, 'SKILL.md')

    try {
      statSync(skillMdPath)
    } catch {
      throw new Error(`SKILL.md not found in ${skillPath}`)
    }

    const frontmatter = this.parseFrontmatterSync(skillMdPath)
    this.skills.set(frontmatter.name, {
      name: frontmatter.name,
      description: frontmatter.description,
      path: skillPath,
    })
  }

  /**
   * Synchronous version: Scan a directory and add all valid skills found
   */
  scanDirectorySync(dir: string): void {
    const resolved = this.resolvePath(dir)

    try {
      const entries = readdirSync(resolved, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = join(resolved, entry.name)
          try {
            this.addSkillSync(skillPath)
          } catch {
            // Not a valid skill, skip
          }
        }
      }
    } catch {
      // Directory doesn't exist, ignore
    }
  }

  /**
   * Synchronous version: Parse YAML frontmatter from SKILL.md
   */
  private parseFrontmatterSync(skillMdPath: string): z.infer<
    typeof frontmatterSchema
  > {
    const content = readFileSync(skillMdPath, 'utf-8')
    const match = content.match(/^---\n([\s\S]+?)\n---/)

    if (!match) {
      throw new Error(`Invalid SKILL.md: missing frontmatter in ${skillMdPath}`)
    }

    try {
      return frontmatterSchema.parse(parseYaml(match[1]))
    } catch (error) {
      throw new Error(
        `Invalid frontmatter in ${skillMdPath}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Add skills from a SkillImporter (async)
   * Used for temporary imported skills during session lifecycle
   */
  async addImportedSkills(
    importer: { getAllImportedSkillPaths(): string[] }
  ): Promise<void> {
    const skillPaths = importer.getAllImportedSkillPaths()

    for (const skillPath of skillPaths) {
      await this.addSkill(skillPath)
    }
  }

  /**
   * Add skills from a SkillImporter (sync)
   */
  addImportedSkillsSync(
    importer: { getAllImportedSkillPaths(): string[] }
  ): void {
    const skillPaths = importer.getAllImportedSkillPaths()

    for (const skillPath of skillPaths) {
      this.addSkillSync(skillPath)
    }
  }
}
