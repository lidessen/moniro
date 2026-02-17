/**
 * Variable interpolation for workflow YAML.
 *
 * Replaces ${{ expr }} in kickoff and system_prompt strings.
 * Sources: setup outputs, environment variables, workflow metadata.
 */

export interface InterpolationContext {
  /** Outputs from setup commands (keyed by `as` name) */
  setup: Record<string, string>;
  /** Environment variables */
  env: Record<string, string | undefined>;
  /** Workflow metadata */
  workflow: {
    name: string;
    tag: string;
  };
}

const VARIABLE_PATTERN = /\$\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * Replace ${{ expr }} with values from the context.
 *
 * Supported expressions:
 *   ${{ varName }}        — setup output
 *   ${{ env.VAR }}        — environment variable
 *   ${{ workflow.name }}  — workflow metadata
 *   ${{ workflow.tag }}   — workflow metadata
 */
export function interpolate(template: string, ctx: InterpolationContext): string {
  return template.replace(VARIABLE_PATTERN, (match, expr: string) => {
    const key = expr.trim();

    // env.VAR
    if (key.startsWith("env.")) {
      const envKey = key.slice(4);
      return ctx.env[envKey] ?? match;
    }

    // workflow.name / workflow.tag
    if (key.startsWith("workflow.")) {
      const prop = key.slice(9) as keyof InterpolationContext["workflow"];
      return ctx.workflow[prop] ?? match;
    }

    // setup output (bare name)
    if (key in ctx.setup) {
      return ctx.setup[key] ?? match;
    }

    // Unresolved — leave as-is
    return match;
  });
}
