/**
 * Variable interpolation for workflow templates
 *
 * Syntax: ${{ variable }}
 * - ${{ name }} - task output variable
 * - ${{ env.VAR }} - environment variable
 * - ${{ workflow.name }} - workflow name
 * - ${{ workflow.tag }} - workflow instance tag
 * - ${{ workflow.instance }} - (deprecated) alias for workflow.tag
 */

export interface VariableContext {
  /** Task output variables */
  [key: string]:
    | string
    | undefined
    | Record<string, string | undefined>
    | { name: string; tag: string; instance?: string };

  /** Environment variables (accessed via env.VAR) */
  env?: Record<string, string | undefined>;

  /** Workflow metadata */
  workflow?: {
    name: string;
    /** Workflow instance tag */
    tag: string;
    /** @deprecated Use tag instead */
    instance?: string;
  };
}

const VARIABLE_PATTERN = /\$\{\{\s*([^}]+)\s*\}\}/g;

/**
 * Interpolate variables in a template string
 * @param warn Optional callback for unresolved variables
 */
export function interpolate(
  template: string,
  context: VariableContext,
  warn?: (msg: string) => void,
): string {
  return template.replace(VARIABLE_PATTERN, (match, expression) => {
    const value = resolveExpression(expression.trim(), context);
    if (value === undefined && warn) {
      warn("Unresolved variable: ${{ " + expression.trim() + " }} — no setup task defines it");
    }
    return value ?? match; // Keep original if not found
  });
}

/**
 * Resolve a variable expression
 */
function resolveExpression(expression: string, context: VariableContext): string | undefined {
  // Handle env.VAR
  if (expression.startsWith("env.")) {
    const varName = expression.slice(4);
    return context.env?.[varName] ?? process.env[varName];
  }

  // Handle workflow.name, workflow.tag, workflow.instance (deprecated)
  if (expression.startsWith("workflow.")) {
    const field = expression.slice(9);
    if (field === "name") return context.workflow?.name;
    if (field === "tag") return context.workflow?.tag;
    if (field === "instance") return context.workflow?.instance || context.workflow?.tag; // Backward compat
    return undefined;
  }

  // Direct variable lookup
  const value = context[expression];
  return typeof value === "string" ? value : undefined;
}

/**
 * Check if a string contains variables
 */
export function hasVariables(str: string): boolean {
  VARIABLE_PATTERN.lastIndex = 0;
  return VARIABLE_PATTERN.test(str);
}

/**
 * Extract all variable names from a template
 */
export function extractVariables(template: string): string[] {
  const variables: string[] = [];
  let match: RegExpExecArray | null;

  VARIABLE_PATTERN.lastIndex = 0;
  while ((match = VARIABLE_PATTERN.exec(template)) !== null) {
    if (match[1]) {
      variables.push(match[1].trim());
    }
  }

  return variables;
}

/**
 * Evaluate a condition expression
 * Supports simple boolean logic
 */
export function evaluateCondition(expression: string, context: VariableContext): boolean {
  // First interpolate variables
  const interpolated = interpolate(expression, context);

  // Simple evaluations
  // Check for .contains(), .startsWith(), .endsWith()
  const containsMatch = interpolated.match(/^(.+)\.contains\(['"](.+)['"]\)$/);
  if (containsMatch) {
    const [, value, search] = containsMatch;
    if (value && search) {
      return value.includes(search);
    }
  }

  const startsWithMatch = interpolated.match(/^(.+)\.startsWith\(['"](.+)['"]\)$/);
  if (startsWithMatch) {
    const [, value, search] = startsWithMatch;
    if (value && search) {
      return value.startsWith(search);
    }
  }

  const endsWithMatch = interpolated.match(/^(.+)\.endsWith\(['"](.+)['"]\)$/);
  if (endsWithMatch) {
    const [, value, search] = endsWithMatch;
    if (value && search) {
      return value.endsWith(search);
    }
  }

  // Check for inequality FIRST (before equality, since !== contains ==)
  const notEqualMatch = interpolated.match(/^(.+?)\s*!==?\s*['"](.+)['"]$/);
  if (notEqualMatch) {
    const [, left, right] = notEqualMatch;
    if (left && right) {
      return left.trim() !== right;
    }
  }

  // Check for equality (use non-greedy match to avoid capturing operator)
  const equalMatch = interpolated.match(/^(.+?)\s*===?\s*['"](.+)['"]$/);
  if (equalMatch) {
    const [, left, right] = equalMatch;
    if (left && right) {
      return left.trim() === right;
    }
  }

  // Check for existence (truthy)
  if (interpolated.trim()) {
    // If it's just a variable that resolved to a value, it's truthy
    return interpolated !== expression; // Changed from template
  }

  return false;
}

/**
 * Create a context from workflow metadata
 */
export function createContext(
  workflowName: string,
  tag: string,
  taskOutputs: Record<string, string> = {},
): VariableContext {
  return {
    ...taskOutputs,
    env: process.env as Record<string, string>,
    workflow: {
      name: workflowName,
      tag,
      instance: tag, // Backward compatibility
    },
  };
}
