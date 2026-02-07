import type { SkillsProvider } from '../skills/provider.ts'
import type { ToolDefinition } from '../types.ts'

/**
 * Create a Skills tool that provides access to agent skills
 */
export function createSkillsTool(provider: SkillsProvider): ToolDefinition {
  return {
    name: 'Skills',
    description:
      'Interact with available agent skills. Use "list" to see all skills with their descriptions, "view" to read a complete SKILL.md file, "readFile" to read files within a skill directory (e.g., references/, scripts/, assets/).',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['list', 'view', 'readFile'],
          description: 'Operation to perform',
        },
        skillName: {
          type: 'string',
          description: 'Skill name (required for view and readFile operations)',
        },
        filePath: {
          type: 'string',
          description:
            'Relative file path within the skill directory (required for readFile operation, e.g., "references/search-strategies.md")',
        },
      },
      required: ['operation'],
    },
    execute: async (args: Record<string, unknown>) => {
      const operation = args.operation as string
      const skillName = args.skillName as string | undefined
      const filePath = args.filePath as string | undefined

      switch (operation) {
        case 'list': {
          const skills = provider.list()
          if (skills.length === 0) {
            return { message: 'No skills available' }
          }
          return {
            skills: skills.map((s) => ({
              name: s.name,
              description: s.description,
            })),
          }
        }

        case 'view': {
          if (!skillName) {
            throw new Error('skillName is required for view operation')
          }
          const content = await provider.view(skillName)
          return { content }
        }

        case 'readFile': {
          if (!skillName || !filePath) {
            throw new Error(
              'skillName and filePath are required for readFile operation'
            )
          }
          const content = await provider.readFile(skillName, filePath)
          return { content }
        }

        default:
          throw new Error(`Unknown operation: ${operation}`)
      }
    },
  }
}
