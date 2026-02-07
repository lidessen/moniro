/**
 * Cron Parser Unit Tests
 *
 * Tests the minimal cron expression parser in daemon/cron.ts.
 * Covers field parsing, next-time calculation, and edge cases.
 */

import { describe, test, expect } from "bun:test";
import { parseCron, nextCronTime, msUntilNextCron } from "../../src/daemon/cron.ts";
import { parseDuration, resolveSchedule } from "../../src/daemon/registry.ts";

describe("parseCron", () => {
  test("parses wildcard fields", () => {
    const fields = parseCron("* * * * *");
    expect(fields.minutes.size).toBe(60); // 0-59
    expect(fields.hours.size).toBe(24); // 0-23
    expect(fields.daysOfMonth.size).toBe(31); // 1-31
    expect(fields.months.size).toBe(12); // 1-12
    expect(fields.daysOfWeek.size).toBe(7); // 0-6
  });

  test("parses exact values", () => {
    const fields = parseCron("30 14 1 6 3");
    expect([...fields.minutes]).toEqual([30]);
    expect([...fields.hours]).toEqual([14]);
    expect([...fields.daysOfMonth]).toEqual([1]);
    expect([...fields.months]).toEqual([6]);
    expect([...fields.daysOfWeek]).toEqual([3]);
  });

  test("parses step values", () => {
    const fields = parseCron("*/15 */6 * * *");
    expect([...fields.minutes].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
    expect([...fields.hours].sort((a, b) => a - b)).toEqual([0, 6, 12, 18]);
  });

  test("parses ranges", () => {
    const fields = parseCron("0-5 9-17 * * *");
    expect([...fields.minutes].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect([...fields.hours].sort((a, b) => a - b)).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
  });

  test("parses lists", () => {
    const fields = parseCron("0,30 9,12,18 * * *");
    expect([...fields.minutes].sort((a, b) => a - b)).toEqual([0, 30]);
    expect([...fields.hours].sort((a, b) => a - b)).toEqual([9, 12, 18]);
  });

  test("parses range with step", () => {
    const fields = parseCron("0-30/10 * * * *");
    expect([...fields.minutes].sort((a, b) => a - b)).toEqual([0, 10, 20, 30]);
  });

  test("throws on invalid field count", () => {
    expect(() => parseCron("* * *")).toThrow("expected 5 fields");
    expect(() => parseCron("* * * * * *")).toThrow("expected 5 fields");
  });

  test("throws on non-numeric values", () => {
    expect(() => parseCron("abc * * * *")).toThrow("Invalid number");
    expect(() => parseCron("* * * * foo")).toThrow("Invalid number");
    expect(() => parseCron("a-b * * * *")).toThrow("Invalid number");
    expect(() => parseCron("*/x * * * *")).toThrow("Invalid number");
  });
});

describe("nextCronTime", () => {
  test("finds next minute for every-minute cron", () => {
    const from = new Date("2026-02-07T10:30:00Z");
    const next = nextCronTime("* * * * *", from);
    expect(next.getTime()).toBe(new Date("2026-02-07T10:31:00Z").getTime());
  });

  test("finds next matching minute", () => {
    const from = new Date("2026-02-07T10:20:00Z");
    const next = nextCronTime("30 * * * *", from);
    expect(next.getMinutes()).toBe(30);
    expect(next.getHours()).toBe(10);
  });

  test("rolls to next hour if past target minute", () => {
    const from = new Date("2026-02-07T10:35:00Z");
    const next = nextCronTime("30 * * * *", from);
    expect(next.getMinutes()).toBe(30);
    expect(next.getHours()).toBe(11);
  });

  test("handles every-2-hours cron", () => {
    const from = new Date("2026-02-07T09:00:00Z");
    const next = nextCronTime("0 */2 * * *", from);
    expect(next.getMinutes()).toBe(0);
    expect(next.getHours()).toBe(10);
  });

  test("handles specific day of week", () => {
    // 2026-02-07 is a Saturday (day 6)
    const from = new Date("2026-02-07T10:00:00Z");
    // Find next Monday (day 1)
    const next = nextCronTime("0 9 * * 1", from);
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  test("returns time in the future", () => {
    const from = new Date();
    const next = nextCronTime("* * * * *", from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });
});

describe("msUntilNextCron", () => {
  test("returns positive milliseconds", () => {
    const ms = msUntilNextCron("* * * * *");
    expect(ms).toBeGreaterThan(0);
    // Every-minute cron should be <= 60 seconds away
    expect(ms).toBeLessThanOrEqual(60 * 1000);
  });

  test("returns correct delay for specific time", () => {
    const from = new Date("2026-02-07T10:00:00Z");
    const ms = msUntilNextCron("30 10 * * *", from);
    // Should be 30 minutes = 1800000ms
    expect(ms).toBe(30 * 60 * 1000);
  });
});

describe("parseDuration", () => {
  test("parses milliseconds", () => {
    expect(parseDuration("500ms")).toBe(500);
  });

  test("parses seconds", () => {
    expect(parseDuration("30s")).toBe(30_000);
  });

  test("parses minutes", () => {
    expect(parseDuration("5m")).toBe(300_000);
  });

  test("parses hours", () => {
    expect(parseDuration("2h")).toBe(7_200_000);
  });

  test("parses days", () => {
    expect(parseDuration("1d")).toBe(86_400_000);
  });

  test("parses decimal values", () => {
    expect(parseDuration("1.5h")).toBe(5_400_000);
  });

  test("returns null for non-duration strings", () => {
    expect(parseDuration("0 */2 * * *")).toBeNull();
    expect(parseDuration("hello")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });
});

describe("resolveSchedule", () => {
  test("resolves number as interval", () => {
    const result = resolveSchedule({ wakeup: 60000 });
    expect(result.type).toBe("interval");
    expect(result.ms).toBe(60000);
  });

  test("resolves duration string as interval", () => {
    const result = resolveSchedule({ wakeup: "5m" });
    expect(result.type).toBe("interval");
    expect(result.ms).toBe(300_000);
  });

  test("resolves cron expression as cron", () => {
    const result = resolveSchedule({ wakeup: "0 */2 * * *" });
    expect(result.type).toBe("cron");
    expect(result.expr).toBe("0 */2 * * *");
  });

  test("preserves prompt", () => {
    const result = resolveSchedule({ wakeup: "30s", prompt: "Check tasks" });
    expect(result.prompt).toBe("Check tasks");
  });

  test("throws for non-positive number", () => {
    expect(() => resolveSchedule({ wakeup: 0 })).toThrow("positive");
    expect(() => resolveSchedule({ wakeup: -1 })).toThrow("positive");
  });
});
