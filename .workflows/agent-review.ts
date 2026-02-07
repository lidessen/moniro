#!/usr/bin/env bun
/**
 * /agent-review — PR review using DeepSeek chat + on-demand reasoner
 *
 * Chat model does the main review. When it encounters complex logic,
 * security concerns, or tricky edge cases, it invokes the reasoner
 * tool for deep analysis.
 *
 * Usage: bun .workflows/agent-review.ts
 * Env: PR_NUMBER, GITHUB_REPOSITORY, GH_TOKEN, DEEPSEEK_API_KEY
 */

import { AgentSession, createModelAsync } from "agent-worker";
import { tool, jsonSchema, generateText } from "ai";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ==================== Environment ====================

const PR_NUMBER = process.env.PR_NUMBER;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

if (!PR_NUMBER || !GITHUB_REPOSITORY) {
  console.error("Missing required env: PR_NUMBER, GITHUB_REPOSITORY");
  process.exit(1);
}

// ==================== Gather PR Info ====================

function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 30000 }).trim();
  } catch (error) {
    console.error(`Command failed: ${cmd}`);
    throw error;
  }
}

console.log(`Gathering PR #${PR_NUMBER} info...`);

const prInfo = sh(
  `gh pr view "${PR_NUMBER}" --repo "${GITHUB_REPOSITORY}" --json title,body,baseRefName,headRefName,author,additions,deletions,changedFiles`,
);
const changedFiles = sh(
  `gh pr view "${PR_NUMBER}" --repo "${GITHUB_REPOSITORY}" --json files --jq '.files[].path'`,
);
let prDiff = sh(`gh pr diff "${PR_NUMBER}" --repo "${GITHUB_REPOSITORY}"`);

// Truncate large diffs to stay within context limits
const MAX_DIFF_CHARS = 48000;
if (prDiff.length > MAX_DIFF_CHARS) {
  prDiff = prDiff.slice(0, MAX_DIFF_CHARS) + "\n\n... (diff truncated, review changed files for full context)";
}

// ==================== Tools ====================

// Bash tool — unsandboxed, runs in the real CI environment
const bash = tool({
  description:
    "Execute a shell command. Use this to post the review comment via gh CLI.",
  parameters: jsonSchema<{ command: string }>({
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
    },
    required: ["command"],
  }),
  execute: async ({ command }: { command: string }) => {
    try {
      const result = execSync(command, {
        encoding: "utf-8",
        timeout: 60000,
        env: process.env as Record<string, string>,
      });
      return result.trim() || "(no output)";
    } catch (error: any) {
      return `Error (exit ${error.status}): ${error.stderr || error.message}`;
    }
  },
});

// Reasoner tool — invokes DeepSeek R1 for deep analysis on demand
const reasonerModel = await createModelAsync("deepseek/deepseek-reasoner");

const reason = tool({
  description:
    "Invoke DeepSeek Reasoner (R1) for deep analysis. Use when you need to reason through complex logic, subtle bugs, security implications, race conditions, or architectural concerns. Pass the specific code snippet and your question.",
  parameters: jsonSchema<{ question: string; code?: string }>({
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "What to analyze — be specific about what concerns you",
      },
      code: {
        type: "string",
        description: "The code snippet to analyze (optional, include if relevant)",
      },
    },
    required: ["question"],
  }),
  execute: async ({ question, code }: { question: string; code?: string }) => {
    const prompt = code ? `${question}\n\n\`\`\`\n${code}\n\`\`\`` : question;
    console.log(`  [reasoner] Analyzing: ${question.slice(0, 80)}...`);
    const result = await generateText({
      model: reasonerModel,
      prompt,
      maxOutputTokens: 8192,
    });
    return result.text;
  },
});

// ==================== Session ====================

const systemPrompt = readFileSync(join(__dirname, "prompts/reviewer.md"), "utf-8");

const session = new AgentSession({
  model: "deepseek/deepseek-chat",
  system: systemPrompt,
  tools: { bash, reason },
  maxSteps: 15,
  maxTokens: 8192,
});

// ==================== Run ====================

const prompt = `Review this pull request and post your review as a comment.

## PR Info
${prInfo}

## Changed Files
${changedFiles}

## Diff
${prDiff}

When your review is ready, post it using:
gh pr comment "${PR_NUMBER}" --repo "${GITHUB_REPOSITORY}" --body "<your review>"`;

console.log(`Starting review of PR #${PR_NUMBER}...`);

const response = await session.send(prompt, {
  onStepFinish: ({ stepNumber, toolCalls }) => {
    for (const tc of toolCalls) {
      const preview =
        tc.name === "reason"
          ? `reason: ${(tc.arguments as any).question?.slice(0, 60)}...`
          : `bash: ${(tc.arguments as any).command?.slice(0, 60)}...`;
      console.log(`  [step ${stepNumber}] ${preview}`);
    }
  },
});

console.log(`Review complete. ${session.stats().usage.total} tokens used.`);
