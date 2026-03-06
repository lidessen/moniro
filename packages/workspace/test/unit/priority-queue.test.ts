/**
 * Priority Queue Tests
 *
 * Tests for InstructionQueue, priority classification, and instruction ID generation.
 */

import { describe, test, expect } from "bun:test";
import {
  InstructionQueue,
  generateInstructionId,
  classifyInboxPriority,
  type AgentInstruction,
  type InstructionPriority,
} from "@moniro/workspace";

function makeInstruction(
  priority: InstructionPriority,
  message: string = "test",
  source: AgentInstruction["source"] = "mention",
): AgentInstruction {
  return {
    id: generateInstructionId(),
    message,
    source,
    priority,
    queuedAt: new Date().toISOString(),
  };
}

describe("InstructionQueue", () => {
  test("empty queue returns null on dequeue", () => {
    const q = new InstructionQueue();
    expect(q.dequeue()).toBeNull();
    expect(q.peek()).toBeNull();
    expect(q.isEmpty).toBe(true);
    expect(q.size).toBe(0);
  });

  test("single instruction enqueue and dequeue", () => {
    const q = new InstructionQueue();
    const instr = makeInstruction("normal", "hello");
    q.enqueue(instr);
    expect(q.size).toBe(1);
    expect(q.isEmpty).toBe(false);
    expect(q.dequeue()).toBe(instr);
    expect(q.isEmpty).toBe(true);
  });

  test("dequeue returns immediate before normal", () => {
    const q = new InstructionQueue();
    const normal = makeInstruction("normal", "normal msg");
    const immediate = makeInstruction("immediate", "urgent msg");

    q.enqueue(normal);
    q.enqueue(immediate);

    expect(q.dequeue()!.message).toBe("urgent msg");
    expect(q.dequeue()!.message).toBe("normal msg");
  });

  test("dequeue returns normal before background", () => {
    const q = new InstructionQueue();
    const bg = makeInstruction("background", "bg msg");
    const normal = makeInstruction("normal", "normal msg");

    q.enqueue(bg);
    q.enqueue(normal);

    expect(q.dequeue()!.message).toBe("normal msg");
    expect(q.dequeue()!.message).toBe("bg msg");
  });

  test("full priority ordering: immediate > normal > background", () => {
    const q = new InstructionQueue();

    q.enqueue(makeInstruction("background", "bg"));
    q.enqueue(makeInstruction("normal", "normal"));
    q.enqueue(makeInstruction("immediate", "imm"));

    expect(q.dequeue()!.message).toBe("imm");
    expect(q.dequeue()!.message).toBe("normal");
    expect(q.dequeue()!.message).toBe("bg");
    expect(q.dequeue()).toBeNull();
  });

  test("FIFO within same priority lane", () => {
    const q = new InstructionQueue();

    q.enqueue(makeInstruction("normal", "first"));
    q.enqueue(makeInstruction("normal", "second"));
    q.enqueue(makeInstruction("normal", "third"));

    expect(q.dequeue()!.message).toBe("first");
    expect(q.dequeue()!.message).toBe("second");
    expect(q.dequeue()!.message).toBe("third");
  });

  test("peek does not remove", () => {
    const q = new InstructionQueue();
    const instr = makeInstruction("normal", "peek me");
    q.enqueue(instr);

    expect(q.peek()).toBe(instr);
    expect(q.size).toBe(1);
    expect(q.peek()).toBe(instr);
  });

  test("peek returns highest priority", () => {
    const q = new InstructionQueue();

    q.enqueue(makeInstruction("background", "bg"));
    q.enqueue(makeInstruction("immediate", "imm"));

    expect(q.peek()!.message).toBe("imm");
  });

  test("hasHigherPriority: nothing higher than immediate", () => {
    const q = new InstructionQueue();
    q.enqueue(makeInstruction("immediate"));
    expect(q.hasHigherPriority("immediate")).toBe(false);
  });

  test("hasHigherPriority: immediate is higher than normal", () => {
    const q = new InstructionQueue();
    q.enqueue(makeInstruction("immediate"));
    expect(q.hasHigherPriority("normal")).toBe(true);
  });

  test("hasHigherPriority: immediate and normal are higher than background", () => {
    const q = new InstructionQueue();
    q.enqueue(makeInstruction("normal"));
    expect(q.hasHigherPriority("background")).toBe(true);
  });

  test("hasHigherPriority: empty queue has nothing higher", () => {
    const q = new InstructionQueue();
    expect(q.hasHigherPriority("background")).toBe(false);
    expect(q.hasHigherPriority("normal")).toBe(false);
    expect(q.hasHigherPriority("immediate")).toBe(false);
  });

  test("size tracks all lanes", () => {
    const q = new InstructionQueue();
    q.enqueue(makeInstruction("immediate"));
    q.enqueue(makeInstruction("normal"));
    q.enqueue(makeInstruction("background"));
    expect(q.size).toBe(3);

    q.dequeue();
    expect(q.size).toBe(2);
  });

  test("clear empties all lanes", () => {
    const q = new InstructionQueue();
    q.enqueue(makeInstruction("immediate"));
    q.enqueue(makeInstruction("normal"));
    q.enqueue(makeInstruction("background"));
    expect(q.size).toBe(3);

    q.clear();
    expect(q.size).toBe(0);
    expect(q.isEmpty).toBe(true);
    expect(q.dequeue()).toBeNull();
  });

  test("interleaved enqueue/dequeue respects priority", () => {
    const q = new InstructionQueue();

    q.enqueue(makeInstruction("normal", "n1"));
    q.enqueue(makeInstruction("background", "b1"));
    expect(q.dequeue()!.message).toBe("n1");

    // Add immediate while background is still queued
    q.enqueue(makeInstruction("immediate", "i1"));
    expect(q.dequeue()!.message).toBe("i1");
    expect(q.dequeue()!.message).toBe("b1");
  });
});

describe("generateInstructionId", () => {
  test("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateInstructionId());
    }
    expect(ids.size).toBe(100);
  });

  test("IDs start with instr_ prefix", () => {
    const id = generateInstructionId();
    expect(id.startsWith("instr_")).toBe(true);
  });
});

describe("classifyInboxPriority", () => {
  test("DMs are always immediate", () => {
    expect(classifyInboxPriority("normal", true)).toBe("immediate");
    expect(classifyInboxPriority("high", true)).toBe("immediate");
  });

  test("high inbox priority maps to immediate", () => {
    expect(classifyInboxPriority("high", false)).toBe("immediate");
  });

  test("normal inbox priority maps to normal", () => {
    expect(classifyInboxPriority("normal", false)).toBe("normal");
  });
});
