/**
 * Personal prompt sections — soul, memory, todo.
 *
 * These sections establish agent identity and are injected BEFORE
 * any workspace/collaboration sections. They return null when no
 * personal context is available (e.g., for anonymous/inline agents).
 */

import type { PersonalPromptSection } from "./types.ts";

/** Soul — persistent identity (who you are always) */
export const soulSection: PersonalPromptSection = (ctx) => {
  const soul = ctx.personalContext?.soul;
  if (!soul) return null;

  const lines: string[] = ["## Identity"];
  if (soul.role) lines.push(`**Role**: ${soul.role}`);
  if (soul.expertise?.length) lines.push(`**Expertise**: ${soul.expertise.join(", ")}`);
  if (soul.style) lines.push(`**Style**: ${soul.style}`);
  if (soul.principles?.length) {
    lines.push("**Principles**:");
    for (const p of soul.principles) {
      lines.push(`- ${p}`);
    }
  }
  return lines.length > 1 ? lines.join("\n") : null;
};

/** Memory — persistent knowledge (what you know) */
export const memorySection: PersonalPromptSection = (ctx) => {
  const memory = ctx.personalContext?.memory;
  if (!memory || Object.keys(memory).length === 0) return null;

  const lines: string[] = ["## Memory"];
  for (const [key, value] of Object.entries(memory)) {
    if (typeof value === "string") {
      lines.push(`- **${key}**: ${value}`);
    } else {
      lines.push(`- **${key}**: ${JSON.stringify(value)}`);
    }
  }
  return lines.join("\n");
};

/** Todos — active tasks (what you need to do) */
export const todoSection: PersonalPromptSection = (ctx) => {
  const todos = ctx.personalContext?.todos;
  if (!todos || todos.length === 0) return null;

  const lines = ["## Active Tasks", ...todos.map((t) => `- [ ] ${t}`)];
  return lines.join("\n");
};

/** Default personal prompt sections (identity first) */
export const DEFAULT_PERSONAL_SECTIONS: PersonalPromptSection[] = [
  soulSection,
  memorySection,
  todoSection,
];

/**
 * Assemble prompt from personal sections.
 * Joins non-null sections with blank lines.
 */
export function assemblePersonalPrompt(
  sections: PersonalPromptSection[],
  ctx: import("./types.ts").PersonalPromptContext,
): string {
  return sections
    .map((section) => section(ctx))
    .filter((content): content is string => content !== null)
    .join("\n\n");
}
