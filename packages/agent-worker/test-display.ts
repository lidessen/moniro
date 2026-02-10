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

  // Banner with gradient
  const BANNER_LINES = [
    " █████╗  ██████╗ ███████╗███╗   ██╗████████╗    ██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗██████╗",
    "██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝    ██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝██╔══██╗",
    "███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║       ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ █████╗  ██████╔╝",
    "██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║       ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ██╔══╝  ██╔══██╗",
    "██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║       ╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████╗██║  ██║",
    "╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝        ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝",
  ];

  // Apply gradient: cyan → blue → magenta
  const colors = [pc.cyan, pc.cyan, pc.blue, pc.blue, pc.magenta, pc.magenta];
  const banner = BANNER_LINES.map((line, i) => colors[i]!(line)).join("\n");
  console.log("\n" + banner);

  // Intro
  p.intro(pc.bgCyan(pc.black(" test-workflow:main ")));

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

  // Simulate real workflow execution
  p.log.step(pc.dim("Inbox: 1 message(s) from [system]"));
  await sleep(400);

  p.log.step(pc.dim("Running (attempt 1/3)"));
  await sleep(400);

  // Tool calls with ▶ symbol and "called" format
  p.log.message(`${pc.cyan("assistant")} called ${pc.bold(pc.cyan("my_inbox"))}${pc.dim("()")}`, {
    symbol: pc.cyan("▶"),
  });
  await sleep(300);

  p.log.message(`${pc.cyan("assistant")} called ${pc.bold(pc.cyan("channel_read"))}${pc.dim("(limit=20)")}`, {
    symbol: pc.cyan("▶"),
  });
  await sleep(300);

  p.log.message(
    `${pc.cyan("assistant")} called ${pc.bold(pc.cyan("channel_send"))}${pc.dim('(message="Analyzing the request...")')}`,
    { symbol: pc.cyan("▶") }
  );
  await sleep(500);

  // Agent completion
  p.log.info(pc.green("✓") + " " + pc.dim("3 steps, 3 tool calls, 856ms"));
  await sleep(600);

  // Agent message (note box)
  p.note(
    "I've analyzed the codebase and identified 3 potential improvements:\n\n1. Reduce bundle size by lazy-loading components\n2. Add error boundaries for better resilience\n3. Implement caching layer for API calls",
    pc.cyan("assistant")
  );
  await sleep(1000);

  // Second agent starts
  p.log.step(pc.dim("Inbox: 1 message(s) from [assistant]"));
  await sleep(400);

  p.log.step(pc.dim("Running (attempt 1/3)"));
  await sleep(400);

  p.log.message(`${pc.yellow("reviewer")} called ${pc.bold(pc.cyan("my_inbox"))}${pc.dim("()")}`, {
    symbol: pc.cyan("▶"),
  });
  await sleep(300);

  p.log.message(`${pc.yellow("reviewer")} called ${pc.bold(pc.cyan("channel_read"))}${pc.dim("(limit=20)")}`, {
    symbol: pc.cyan("▶"),
  });
  await sleep(300);

  p.log.message(
    `${pc.yellow("reviewer")} called ${pc.bold(pc.cyan("bash"))}${pc.dim('(command="git diff --stat")')}`,
    { symbol: pc.cyan("▶") }
  );
  await sleep(500);

  p.log.message(
    `${pc.yellow("reviewer")} called ${pc.bold(pc.cyan("channel_send"))}${pc.dim('(message="Review complete. All changes approved.")')}`,
    { symbol: pc.cyan("▶") }
  );
  await sleep(500);

  p.log.info(pc.green("✓") + " " + pc.dim("2 steps, 4 tool calls, 723ms"));
  await sleep(600);

  p.note("The analysis looks good. I approve these changes.", pc.yellow("reviewer"));
  await sleep(800);

  // Final status - integrated naturally
  p.log.info("All agents completed their tasks");
  await sleep(300);

  p.log.warn("Cache miss for 2 resources, fetching from origin");
  await sleep(300);

  p.log.success(`Completed in ${pc.bold("3.5")}s`);
  await sleep(500);

  p.outro("Done");
}

main().catch(console.error);
