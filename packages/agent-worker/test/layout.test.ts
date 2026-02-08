/**
 * Layout system tests
 *
 * Tests adaptive layout calculation, text wrapping, and message grouping
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  calculateLayout,
  formatTime,
  resetTimeTracking,
  shouldGroup,
  createGroupingState,
  getIndent,
  padToWidth,
  getWidth,
  LAYOUT_PRESETS,
} from "../src/workflow/layout.ts";

describe("Layout System", () => {
  describe("calculateLayout", () => {
    it("should calculate adaptive layout for short agent names", () => {
      const layout = calculateLayout({
        agentNames: ["ai", "user"],
        terminalWidth: 80,
      });

      expect(layout.terminalWidth).toBe(80);
      expect(layout.timeWidth).toBe(8); // HH:MM:SS (always full format)
      expect(layout.nameWidth).toBeGreaterThanOrEqual(6); // At least 6 for "system"
      expect(layout.maxContentWidth).toBeLessThanOrEqual(80);
      expect(layout.compactTime).toBe(false); // Always use full time format
    });

    it("should adapt to long agent names", () => {
      const layout = calculateLayout({
        agentNames: ["alice", "bob", "very-long-agent-name"],
        terminalWidth: 120,
      });

      // Name width should accommodate longest name
      expect(layout.nameWidth).toBeGreaterThanOrEqual("very-long-agent-name".length);
      expect(layout.nameWidth).toBeLessThanOrEqual(20); // Cap at 20
    });

    it("should respect terminal width constraints", () => {
      const narrowLayout = calculateLayout({
        agentNames: ["agent1", "agent2"],
        terminalWidth: 60,
      });

      const wideLayout = calculateLayout({
        agentNames: ["agent1", "agent2"],
        terminalWidth: 160,
      });

      expect(narrowLayout.maxContentWidth).toBeLessThan(wideLayout.maxContentWidth);
      expect(narrowLayout.maxContentWidth).toBeGreaterThanOrEqual(40); // Minimum content width
    });

    it("should use full time format (HH:MM:SS) by default", () => {
      const layout = calculateLayout({
        agentNames: ["test"],
      });

      expect(layout.compactTime).toBe(false); // Always use HH:MM:SS for precision
      expect(layout.timeWidth).toBe(8); // HH:MM:SS
    });
  });

  describe("formatTime", () => {
    beforeEach(() => {
      resetTimeTracking();
    });

    it("should format time in compact mode", () => {
      const layout = calculateLayout({
        agentNames: ["test"],
        compact: true,
      });

      const timestamp = "2026-02-08T14:30:45Z";
      const result = formatTime(timestamp, layout);

      expect(result.formatted).toMatch(/^\d{2}:\d{2}$/); // MM:SS
    });

    it("should detect minute changes", () => {
      const layout = calculateLayout({ agentNames: ["test"] });

      const t1 = formatTime("2026-02-08T14:30:00Z", layout);
      expect(t1.minuteChanged).toBe(true); // First call

      const t2 = formatTime("2026-02-08T14:30:30Z", layout);
      expect(t2.minuteChanged).toBe(false); // Same minute

      const t3 = formatTime("2026-02-08T14:31:00Z", layout);
      expect(t3.minuteChanged).toBe(true); // New minute
    });
  });

  describe("Message Grouping", () => {
    it("should group consecutive messages from same agent in same minute", () => {
      const state = createGroupingState();

      const shouldGroup1 = shouldGroup("alice", "2026-02-08T14:30:00Z", state, true);
      expect(shouldGroup1).toBe(false); // First message

      const shouldGroup2 = shouldGroup("alice", "2026-02-08T14:30:15Z", state, true);
      expect(shouldGroup2).toBe(true); // Same agent, same minute

      const shouldGroup3 = shouldGroup("alice", "2026-02-08T14:30:45Z", state, true);
      expect(shouldGroup3).toBe(true); // Still same minute
    });

    it("should not group messages from different agents", () => {
      const state = createGroupingState();

      shouldGroup("alice", "2026-02-08T14:30:00Z", state, true);
      const shouldGroup2 = shouldGroup("bob", "2026-02-08T14:30:10Z", state, true);

      expect(shouldGroup2).toBe(false); // Different agent
    });

    it("should not group messages from different minutes", () => {
      const state = createGroupingState();

      shouldGroup("alice", "2026-02-08T14:30:00Z", state, true);
      const shouldGroup2 = shouldGroup("alice", "2026-02-08T14:31:00Z", state, true);

      expect(shouldGroup2).toBe(false); // Different minute
    });

    it("should respect enableGrouping flag", () => {
      const state = createGroupingState();

      shouldGroup("alice", "2026-02-08T14:30:00Z", state, false);
      const shouldGroup2 = shouldGroup("alice", "2026-02-08T14:30:10Z", state, false);

      expect(shouldGroup2).toBe(false); // Grouping disabled
    });
  });

  describe("Width Utilities", () => {
    it("should calculate correct display width for ASCII", () => {
      expect(getWidth("hello")).toBe(5);
      expect(getWidth("test")).toBe(4);
    });

    it("should calculate correct width for fullwidth characters", () => {
      expect(getWidth("你好")).toBe(4); // 2 chars × 2 width each
      expect(getWidth("古")).toBe(2);
    });

    it("should pad text to target width", () => {
      const padded = padToWidth("test", 10);
      expect(getWidth(padded)).toBe(10);
      expect(padded).toBe("test      ");
    });

    it("should handle already-wide text", () => {
      const text = "very long text here";
      const padded = padToWidth(text, 10);
      expect(padded).toBe(text); // No padding needed
    });
  });

  describe("getIndent", () => {
    it("should generate correct indent string", () => {
      const layout = calculateLayout({
        agentNames: ["test"],
        terminalWidth: 80,
      });

      const indent = getIndent(layout, "│");
      const expectedWidth = layout.timeWidth + 1 + layout.nameWidth + 1;

      expect(indent).toContain("│");
      expect(indent.startsWith(" ".repeat(expectedWidth))).toBe(true);
    });
  });

  describe("LAYOUT_PRESETS", () => {
    it("should provide default preset", () => {
      const layout = LAYOUT_PRESETS.default(["alice", "bob"]);
      expect(layout).toBeDefined();
      expect(layout.terminalWidth).toBeGreaterThan(0);
      expect(layout.maxContentWidth).toBeGreaterThan(0);
    });

    it("should provide compact preset with wider content", () => {
      const layout = LAYOUT_PRESETS.compact(["alice", "bob"]);
      expect(layout.maxContentWidth).toBe(120);
    });

    it("should provide wide preset", () => {
      const layout = LAYOUT_PRESETS.wide(["alice", "bob"]);
      expect(layout.maxContentWidth).toBe(120);
    });

    it("should provide narrow preset for split screens", () => {
      const layout = LAYOUT_PRESETS.narrow(["alice", "bob"]);
      expect(layout.terminalWidth).toBe(80);
      expect(layout.maxContentWidth).toBe(50);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very narrow terminals", () => {
      const layout = calculateLayout({
        agentNames: ["a"],
        terminalWidth: 40,
      });

      expect(layout.maxContentWidth).toBeGreaterThanOrEqual(40); // Minimum enforced
    });

    it("should handle very wide terminals", () => {
      const layout = calculateLayout({
        agentNames: ["test"],
        terminalWidth: 200,
      });

      expect(layout.maxContentWidth).toBeLessThanOrEqual(120); // Respects max setting
    });

    it("should cap agent name width at 20", () => {
      const veryLongName = "a".repeat(50);
      const layout = calculateLayout({
        agentNames: [veryLongName],
      });

      expect(layout.nameWidth).toBeLessThanOrEqual(20);
    });
  });
});
