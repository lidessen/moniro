import { mkdir, rm, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import {
  parseImportSpec,
  buildGitUrl,
  getSpecDisplayName,
  type ImportSpec,
} from './import-spec.ts'

export interface ImportedSkill {
  name: string
  source: string // original import spec
  tempPath: string
}

/**
 * Temporary skill importer for session lifecycle
 * Clones Git repos to temp directory and manages imported skills
 */
export class SkillImporter {
  private tempDir: string
  private imported = new Map<string, ImportedSkill>()
  private sessionId: string

  constructor(sessionId: string) {
    this.sessionId = sessionId
    this.tempDir = join(tmpdir(), `agent-worker-skills-${sessionId}`)
  }

  /**
   * Import skills from a Git repository
   */
  async import(spec: string): Promise<string[]> {
    const parsed = parseImportSpec(spec)

    console.log(`Importing: ${getSpecDisplayName(parsed)}`)

    // 1. Clone repository
    const repoDir = await this.cloneRepo(parsed)

    // 2. Extract specified skills
    const skillNames = await this.extractSkills(repoDir, parsed)

    console.log(`✓ Imported ${skillNames.length} skill(s): ${skillNames.join(', ')}`)

    return skillNames
  }

  /**
   * Import skills from multiple specs
   */
  async importMultiple(specs: string[]): Promise<string[]> {
    const allSkillNames: string[] = []

    for (const spec of specs) {
      try {
        const skillNames = await this.import(spec)
        allSkillNames.push(...skillNames)
      } catch (error) {
        console.error(`Failed to import ${spec}:`, error)
        // Continue with other imports
      }
    }

    return allSkillNames
  }

  /**
   * Get path for an imported skill
   */
  getImportedSkillPath(skillName: string): string | null {
    return this.imported.get(skillName)?.tempPath || null
  }

  /**
   * Get all imported skill paths
   */
  getAllImportedSkillPaths(): string[] {
    return Array.from(this.imported.values()).map((s) => s.tempPath)
  }

  /**
   * Get all imported skills metadata
   */
  getImportedSkills(): ImportedSkill[] {
    return Array.from(this.imported.values())
  }

  /**
   * Get temporary directory path
   */
  getTempDir(): string {
    return this.tempDir
  }

  /**
   * Cleanup temporary directory
   */
  async cleanup(): Promise<void> {
    if (existsSync(this.tempDir)) {
      await rm(this.tempDir, { recursive: true, force: true })
    }
  }

  /**
   * Clone Git repository (shallow clone)
   */
  private async cloneRepo(spec: ImportSpec): Promise<string> {
    // Ensure temp directory exists
    await mkdir(this.tempDir, { recursive: true })

    const repoDir = join(this.tempDir, `${spec.owner}-${spec.repo}`)

    // Skip if already cloned
    if (existsSync(repoDir)) {
      return repoDir
    }

    const gitUrl = buildGitUrl(spec)

    // Shallow clone with specific branch
    await this.execGit([
      'clone',
      '--depth',
      '1',
      '--branch',
      spec.ref,
      '--single-branch',
      gitUrl,
      repoDir,
    ])

    return repoDir
  }

  /**
   * Extract skills from cloned repository
   */
  private async extractSkills(
    repoDir: string,
    spec: ImportSpec
  ): Promise<string[]> {
    // Find skills directory
    const skillsDir = await this.findSkillsDirectory(repoDir)

    // Get list of skills to import
    const skillsToImport =
      spec.skills === 'all'
        ? await this.findAllSkills(skillsDir)
        : spec.skills

    const importedSkills: string[] = []

    // Register each skill
    for (const skillName of skillsToImport) {
      const skillPath = join(skillsDir, skillName)
      const skillMdPath = join(skillPath, 'SKILL.md')

      // Verify SKILL.md exists
      try {
        await stat(skillMdPath)

        this.imported.set(skillName, {
          name: skillName,
          source: spec.rawSpec,
          tempPath: skillPath,
        })

        importedSkills.push(skillName)
      } catch {
        console.warn(`Skipping ${skillName}: SKILL.md not found`)
      }
    }

    if (importedSkills.length === 0) {
      throw new Error(
        `No valid skills found in ${spec.owner}/${spec.repo}`
      )
    }

    return importedSkills
  }

  /**
   * Find skills directory in repository
   * Tries: skills/, agent-skills/, . (root)
   */
  private async findSkillsDirectory(repoDir: string): Promise<string> {
    const candidates = ['skills', 'agent-skills', '.']

    for (const candidate of candidates) {
      const dir = join(repoDir, candidate)
      try {
        const stats = await stat(dir)
        if (stats.isDirectory()) {
          // Check if this directory contains skill directories
          const entries = await readdir(dir, { withFileTypes: true })
          const hasSkills = entries.some(
            (entry) =>
              entry.isDirectory() &&
              existsSync(join(dir, entry.name, 'SKILL.md'))
          )
          if (hasSkills) {
            return dir
          }
        }
      } catch {
        continue
      }
    }

    throw new Error(`No skills directory found in ${repoDir}`)
  }

  /**
   * Find all skills in a directory
   */
  private async findAllSkills(skillsDir: string): Promise<string[]> {
    const entries = await readdir(skillsDir, { withFileTypes: true })
    const skills: string[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMdPath = join(skillsDir, entry.name, 'SKILL.md')
        if (existsSync(skillMdPath)) {
          skills.push(entry.name)
        }
      }
    }

    return skills
  }

  /**
   * Execute git command
   */
  private async execGit(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const git = spawn('git', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''

      git.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      git.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      git.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(
            new Error(
              `Git command failed (exit ${code}): ${stderr || stdout}`
            )
          )
        }
      })

      git.on('error', (error) => {
        reject(new Error(`Failed to spawn git: ${error.message}`))
      })
    })
  }
}
