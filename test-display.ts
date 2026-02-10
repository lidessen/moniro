#!/usr/bin/env bun
/**
 * Test different @clack/prompts display styles
 * Run: bun test-display.ts
 */

import * as p from "@clack/prompts";
import pc from "picocolors";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.clear();

  // Banner
  const BANNER = `
 █████╗  ██████╗ ███████╗███╗   ██╗████████╗    ██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗██████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝    ██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝██╔══██╗
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║       ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ █████╗  ██████╔╝
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║       ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ██╔══╝  ██╔══██╗
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║       ╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████╗██║  ██║
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝        ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
`;
  console.log(pc.cyan(BANNER));

  // Intro
  p.intro(pc.bgCyan(pc.black(" test-workflow:main ")));
  console.log("");

  // Spinner - Initialization
  const s1 = p.spinner();
  s1.start("Initializing 2 agents");
  await sleep(800);
  s1.stop(`Initialized: ${pc.dim("assistant, reviewer")}`);

  // Spinner - Starting
  const s2 = p.spinner();
  s2.start("Starting agents");
  await sleep(800);
  s2.stop();

  console.log("");
  p.log.info("Agents ready and processing");
  console.log("");

  // Tool calls - Different styles
  console.log(pc.bold("=== Tool Call Styles ==="));
  console.log("");

  // Style 1: Current (step with arrow)
  p.log.step(`${pc.cyan("assistant")} ${pc.cyan("→")} ${pc.bold(pc.cyan("my_inbox"))}${pc.dim("()")}`);
  await sleep(300);

  // Style 2: Custom symbol ⚡
  p.log.message(`${pc.cyan("assistant")} ${pc.bold(pc.cyan("channel_read"))}${pc.dim("(limit=20)")}`, {
    symbol: pc.cyan("⚡"),
  });
  await sleep(300);

  // Style 3: Custom symbol ▶
  p.log.message(`${pc.yellow("reviewer")} ${pc.bold(pc.cyan("channel_send"))}${pc.dim('(message="Hello...")')}`, {
    symbol: pc.cyan("▶"),
  });
  await sleep(300);

  // Style 4: Custom symbol ●
  p.log.message(
    `${pc.magenta("validator")} ${pc.dim("→")} ${pc.bold(pc.cyan("bash"))}${pc.dim('(command="npm test")')}`,
    { symbol: pc.cyan("●") }
  );
  await sleep(300);

  console.log("");

  // Agent progress
  console.log(pc.bold("=== Agent Activity ==="));
  console.log("");

  p.log.step(pc.dim("Inbox: 1 message(s) from [system]"));
  await sleep(300);

  p.log.step(pc.dim("Running (attempt 1/3)"));
  await sleep(500);

  // More tool calls in context
  p.log.message(`${pc.cyan("assistant")} ${pc.bold(pc.cyan("my_inbox"))}${pc.dim("()")}`, {
    symbol: pc.cyan("⚡"),
  });
  await sleep(300);

  p.log.message(`${pc.cyan("assistant")} ${pc.bold(pc.cyan("channel_send"))}${pc.dim('(message="Analysis complete")')}`, {
    symbol: pc.cyan("⚡"),
  });
  await sleep(300);

  // Agent completion
  p.log.info(pc.green("✓") + " " + pc.dim("3 steps, 5 tool calls, 1234ms"));
  await sleep(500);

  console.log("");

  // Agent message (note box)
  console.log(pc.bold("=== Agent Messages ==="));
  console.log("");

  p.note(
    "I've analyzed the codebase and identified 3 potential improvements:\n\n1. Reduce bundle size by lazy-loading components\n2. Add error boundaries for better resilience\n3. Implement caching layer for API calls",
    pc.cyan("assistant")
  );
  await sleep(800);

  p.note("The analysis looks good. I approve these changes.", pc.yellow("reviewer"));
  await sleep(800);

  console.log("");

  // Status messages
  console.log(pc.bold("=== Status & Results ==="));
  console.log("");

  p.log.info("All agents completed their tasks");
  await sleep(300);

  p.log.warn("Cache miss for 2 resources, fetching from origin");
  await sleep(300);

  p.log.success(`Completed in ${pc.bold("3.5")}s`);
  await sleep(500);

  console.log("");
  p.outro("Done");
}

main().catch(console.error);
