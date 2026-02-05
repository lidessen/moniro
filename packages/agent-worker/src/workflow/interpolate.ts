/**
 * Variable interpolation for workflow templates
 *
 * Syntax: ${{ variable }}
 * - ${{ name }} - task output variable
 * - ${{ env.VAR }} - environment variable
 * - ${{ workflow.name }} - workflow name
 * - ${{ workflow.instance }} - instance name
 */

export interface VariableContext {
  /** Task output variables */
  [key: string]: string | undefined

  /** Environment variables (accessed via env.VAR) */
  env?: Record<string, string | undefined>

  /** Workflow metadata */
  workflow?: {
    name: string
    instance: string
  }
}

const VARIABLE_PATTERN = /\$\{\{\s*([^}]+)\s*\}\}/g

/**
 * Interpolate variables in a template string
 */
export function interpolate(template: string, context: VariableContext): string {
  return template.replace(VARIABLE_PATTERN, (match, expression) => {
    const value = resolveExpression(expression.trim(), context)
    return value ?? match // Keep original if not found
  })
}

/**
 * Resolve a variable expression
 */
function resolveExpression(expression: string, context: VariableContext): string | undefined {
  // Handle env.VAR
  if (expression.startsWith('env.')) {
    const varName = expression.slice(4)
    return context.env?.[varName] ?? process.env[varName]
  }

  // Handle workflow.name, workflow.instance
  if (expression.startsWith('workflow.')) {
    const field = expression.slice(9)
    if (field === 'name') return context.workflow?.name
    if (field === 'instance') return context.workflow?.instance
    return undefined
  }

  // Direct variable lookup
  const value = context[expression]
  return typeof value === 'string' ? value : undefined
}

/**
 * Check if a string contains variables
 */
export function hasVariables(str: string): boolean {
  VARIABLE_PATTERN.lastIndex = 0
  return VARIABLE_PATTERN.test(str)
}

/**
 * Extract all variable names from a template
 */
export function extractVariables(template: string): string[] {
  const variables: string[] = []
  let match: RegExpExecArray | null

  VARIABLE_PATTERN.lastIndex = 0
  while ((match = VARIABLE_PATTERN.exec(template)) !== null) {
    variables.push(match[1].trim())
  }

  return variables
}

/**
 * Evaluate a condition expression
 * Supports simple boolean logic
 */
export function evaluateCondition(expression: string, context: VariableContext): boolean {
  // First interpolate variables
  const interpolated = interpolate(expression, context)

  // Simple evaluations
  // Check for .contains(), .startsWith(), .endsWith()
  const containsMatch = interpolated.match(/^(.+)\.contains\(['"](.+)['"]\)$/)
  if (containsMatch) {
    const [, value, search] = containsMatch
    return value.includes(search)
  }

  const startsWithMatch = interpolated.match(/^(.+)\.startsWith\(['"](.+)['"]\)$/)
  if (startsWithMatch) {
    const [, value, search] = startsWithMatch
    return value.startsWith(search)
  }

  const endsWithMatch = interpolated.match(/^(.+)\.endsWith\(['"](.+)['"]\)$/)
  if (endsWithMatch) {
    const [, value, search] = endsWithMatch
    return value.endsWith(search)
  }

  // Check for inequality FIRST (before equality, since !== contains ==)
  const notEqualMatch = interpolated.match(/^(.+?)\s*!==?\s*['"](.+)['"]$/)
  if (notEqualMatch) {
    const [, left, right] = notEqualMatch
    return left.trim() !== right
  }

  // Check for equality (use non-greedy match to avoid capturing operator)
  const equalMatch = interpolated.match(/^(.+?)\s*===?\s*['"](.+)['"]$/)
  if (equalMatch) {
    const [, left, right] = equalMatch
    return left.trim() === right
  }

  // Check for existence (truthy)
  if (interpolated.trim()) {
    // If it's just a variable that resolved to a value, it's truthy
    return interpolated !== expression // Changed from template
  }

  return false
}

/**
 * Create a context from workflow metadata
 */
export function createContext(
  workflowName: string,
  instance: string,
  taskOutputs: Record<string, string> = {}
): VariableContext {
  return {
    ...taskOutputs,
    env: process.env as Record<string, string>,
    workflow: {
      name: workflowName,
      instance,
    },
  }
}
