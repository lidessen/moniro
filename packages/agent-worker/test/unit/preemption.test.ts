/**
 * Preemption Tests
 *
 * Tests for cooperative preemption: PreemptionError, shouldYield wiring,
 * and re-queue with progress in processInstruction.
 */

import { describe, test, expect } from "bun:test";
import {
  InstructionQueue,
  generateInstructionId,
  type AgentInstruction,
  type InstructionProgress,
  type AgentRunResult,
} from "@moniro/workspace";

// Import PreemptionError directly from sdk-runner
// (it's not re-exported from index since it's an internal throw-to-exit mechanism)
import { PreemptionError } from "../../node_modules/@moniro/workspace/src/loop/sdk-runner.ts";

// ==================== PreemptionError ====================

describe("PreemptionError", () => {
  test("captures steps completed and work summary", () => {
    const err = new PreemptionError(3, "Step 1: bash(ls)\nStep 2: bash(cat)");
    expect(err.name).toBe("PreemptionError");
    expect(err.stepsCompleted).toBe(3);
    expect(err.completedWork).toBe("Step 1: bash(ls)\nStep 2: bash(cat)");
    expect(err.message).toBe("Preempted after 3 steps");
  });

  test("is instanceof Error", () => {
    const err = new PreemptionError(1, "work");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof PreemptionError).toBe(true);
  });

  test("zero steps", () => {
    const err = new PreemptionError(0, "");
    expect(err.stepsCompleted).toBe(0);
    expect(err.completedWork).toBe("");
  });
});

// ==================== Queue + Preemption Integration ====================

function makeInstruction(
  priority: AgentInstruction["priority"],
  message: string = "test",
  progress?: InstructionProgress,
): AgentInstruction {
  return {
    id: generateInstructionId(),
    message,
    source: "mention",
    priority,
    queuedAt: new Date().toISOString(),
    progress,
  };
}

describe("Queue preemption support", () => {
  test("hasHigherPriority enables shouldYield for background instructions", () => {
    const queue = new InstructionQueue();

    // Background instruction is being processed
    const bgInstruction = makeInstruction("background", "long task");

    // Simulate: shouldYield = () => queue.hasHigherPriority(bgInstruction.priority)
    const shouldYield = () => queue.hasHigherPriority(bgInstruction.priority);

    // Initially no higher priority
    expect(shouldYield()).toBe(false);

    // DM arrives → immediate instruction enqueued
    queue.enqueue(makeInstruction("immediate", "urgent DM"));

    // Now shouldYield returns true
    expect(shouldYield()).toBe(true);
  });

  test("hasHigherPriority: normal instruction not preempted by another normal", () => {
    const queue = new InstructionQueue();
    const shouldYield = () => queue.hasHigherPriority("normal");

    queue.enqueue(makeInstruction("normal", "another normal task"));
    expect(shouldYield()).toBe(false);
  });

  test("hasHigherPriority: immediate instruction never preempted", () => {
    const queue = new InstructionQueue();
    const shouldYield = () => queue.hasHigherPriority("immediate");

    queue.enqueue(makeInstruction("immediate", "another immediate"));
    expect(shouldYield()).toBe(false);
  });

  test("re-queue instruction with progress after preemption", () => {
    const queue = new InstructionQueue();

    // Simulate preemption: background instruction was running, got preempted
    const original = makeInstruction("background", "long task");
    const preemptResult: AgentRunResult = {
      success: true,
      preempted: true,
      completedWork: "Step 1: bash(ls)\nStep 2: bash(cat)",
      duration: 5000,
      steps: 2,
    };

    // Re-queue with progress (same logic as loop.ts)
    const preemptCount = (original.progress?.preemptCount ?? 0) + 1;
    queue.enqueue({
      ...original,
      progress: {
        resumeFromStep: preemptResult.steps ?? 0,
        completedWork: preemptResult.completedWork ?? "",
        preemptCount,
        queuedAt: original.progress?.queuedAt ?? original.queuedAt,
      },
    });

    // Verify the re-queued instruction
    const requeued = queue.dequeue()!;
    expect(requeued.message).toBe("long task");
    expect(requeued.priority).toBe("background");
    expect(requeued.progress).toBeDefined();
    expect(requeued.progress!.resumeFromStep).toBe(2);
    expect(requeued.progress!.completedWork).toBe("Step 1: bash(ls)\nStep 2: bash(cat)");
    expect(requeued.progress!.preemptCount).toBe(1);
    expect(requeued.progress!.queuedAt).toBe(original.queuedAt);
  });

  test("multiple preemptions increment preemptCount", () => {
    const queue = new InstructionQueue();

    // First preemption
    const original = makeInstruction("background", "long task");
    const progress1: InstructionProgress = {
      resumeFromStep: 2,
      completedWork: "Step 1-2",
      preemptCount: 1,
      queuedAt: original.queuedAt,
    };

    // Second preemption — instruction already has progress from first
    const resumed = { ...original, progress: progress1 };
    const preemptCount2 = (resumed.progress?.preemptCount ?? 0) + 1;
    queue.enqueue({
      ...resumed,
      progress: {
        resumeFromStep: 5,
        completedWork: "Step 1-2\nStep 3-5",
        preemptCount: preemptCount2,
        queuedAt: resumed.progress?.queuedAt ?? resumed.queuedAt,
      },
    });

    const requeued = queue.dequeue()!;
    expect(requeued.progress!.preemptCount).toBe(2);
    expect(requeued.progress!.resumeFromStep).toBe(5);
    // Original queuedAt is preserved through multiple preemptions
    expect(requeued.progress!.queuedAt).toBe(original.queuedAt);
  });

  test("preempted instruction resumes at correct priority", () => {
    const queue = new InstructionQueue();

    // Background instruction preempted, re-queued
    queue.enqueue(
      makeInstruction("background", "resumed bg task", {
        resumeFromStep: 3,
        completedWork: "steps 1-3",
        preemptCount: 1,
        queuedAt: new Date().toISOString(),
      }),
    );

    // Normal instruction also queued
    queue.enqueue(makeInstruction("normal", "normal task"));

    // Normal should be dequeued first (higher priority)
    expect(queue.dequeue()!.message).toBe("normal task");
    // Then the resumed background instruction
    const resumed = queue.dequeue()!;
    expect(resumed.message).toBe("resumed bg task");
    expect(resumed.progress!.preemptCount).toBe(1);
  });
});

// ==================== AgentRunResult preemption fields ====================

describe("AgentRunResult preemption", () => {
  test("normal success has no preemption fields", () => {
    const result: AgentRunResult = {
      success: true,
      duration: 1000,
      steps: 5,
      toolCalls: 3,
    };
    expect(result.preempted).toBeUndefined();
    expect(result.completedWork).toBeUndefined();
  });

  test("preempted result has success=true and preemption data", () => {
    const result: AgentRunResult = {
      success: true,
      preempted: true,
      completedWork: "Step 1: channel_send\nStep 2: bash(git status)",
      duration: 3000,
      steps: 2,
    };
    expect(result.success).toBe(true);
    expect(result.preempted).toBe(true);
    expect(result.completedWork).toContain("channel_send");
  });
});
