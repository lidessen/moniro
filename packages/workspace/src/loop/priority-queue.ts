/**
 * Three-lane priority queue for AgentInstructions.
 *
 * Lanes are processed in order: immediate > normal > background.
 * Within each lane, FIFO order is preserved.
 */

import type { AgentInstruction, InstructionPriority } from "./types.ts";

/** Priority order — lower index = higher priority */
const PRIORITY_ORDER: InstructionPriority[] = ["immediate", "normal", "background"];

export class InstructionQueue {
  private lanes: Record<InstructionPriority, AgentInstruction[]> = {
    immediate: [],
    normal: [],
    background: [],
  };

  /** Add an instruction to the appropriate lane */
  enqueue(instruction: AgentInstruction): void {
    this.lanes[instruction.priority].push(instruction);
  }

  /** Remove and return the highest-priority instruction, or null if empty */
  dequeue(): AgentInstruction | null {
    for (const priority of PRIORITY_ORDER) {
      const lane = this.lanes[priority];
      if (lane.length > 0) {
        return lane.shift()!;
      }
    }
    return null;
  }

  /** Peek at the highest-priority instruction without removing it */
  peek(): AgentInstruction | null {
    for (const priority of PRIORITY_ORDER) {
      const lane = this.lanes[priority];
      if (lane.length > 0) {
        return lane[0]!;
      }
    }
    return null;
  }

  /** Check if queue has an instruction with higher priority than the given level */
  hasHigherPriority(than: InstructionPriority): boolean {
    const thanIndex = PRIORITY_ORDER.indexOf(than);
    for (let i = 0; i < thanIndex; i++) {
      if (this.lanes[PRIORITY_ORDER[i]!]!.length > 0) {
        return true;
      }
    }
    return false;
  }

  /** Total number of queued instructions */
  get size(): number {
    return this.lanes.immediate.length + this.lanes.normal.length + this.lanes.background.length;
  }

  /** Whether the queue is empty */
  get isEmpty(): boolean {
    return this.size === 0;
  }

  /** Clear all lanes */
  clear(): void {
    this.lanes.immediate = [];
    this.lanes.normal = [];
    this.lanes.background = [];
  }
}

/** Generate a unique instruction ID */
export function generateInstructionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `instr_${timestamp}${random}`;
}

/** Map inbox priority ("normal" | "high") to instruction priority */
export function classifyInboxPriority(
  inboxPriority: "normal" | "high",
  isDm: boolean,
): InstructionPriority {
  if (isDm) return "immediate";
  if (inboxPriority === "high") return "immediate";
  return "normal";
}
