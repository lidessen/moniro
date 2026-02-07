/**
 * Minimal cron expression parser.
 * Supports standard 5-field cron: minute hour day-of-month month day-of-week
 *
 * Field syntax:
 *   *       every value
 *   N       exact value
 *   N-M     range (inclusive)
 *   N,M,O   list
 *   * /step  every step (e.g. * /15 = 0,15,30,45)  [no space — formatting only]
 *   N-M/step range with step
 */

function range(min: number, max: number): number[] {
  const r: number[] = [];
  for (let i = min; i <= max; i++) r.push(i);
  return r;
}

function parseIntStrict(s: string, context: string): number {
  const n = parseInt(s, 10);
  if (isNaN(n)) throw new Error(`Invalid number "${s}" in ${context}`);
  return n;
}

function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    if (part === "*") {
      for (const v of range(min, max)) values.add(v);
    } else if (part.includes("/")) {
      const [rangeStr, stepStr] = part.split("/");
      const step = parseIntStrict(stepStr!, `step "${part}"`);
      if (step <= 0) throw new Error(`Invalid step: ${part}`);

      let lo = min;
      let hi = max;
      if (rangeStr !== "*") {
        if (rangeStr!.includes("-")) {
          const parts = rangeStr!.split("-");
          lo = parseIntStrict(parts[0]!, `range "${part}"`);
          hi = parseIntStrict(parts[1]!, `range "${part}"`);
        } else {
          lo = parseIntStrict(rangeStr!, `field "${part}"`);
          hi = max;
        }
      }
      for (let v = lo; v <= hi; v += step) values.add(v);
    } else if (part.includes("-")) {
      const parts = part.split("-");
      const lo = parseIntStrict(parts[0]!, `range "${part}"`);
      const hi = parseIntStrict(parts[1]!, `range "${part}"`);
      for (const v of range(lo, hi)) values.add(v);
    } else {
      values.add(parseIntStrict(part, `field "${field}"`));
    }
  }

  return values;
}

export interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

/**
 * Parse a 5-field cron expression into sets of matching values.
 */
export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): ${expr}`);
  }

  return {
    minutes: parseCronField(parts[0]!, 0, 59),
    hours: parseCronField(parts[1]!, 0, 23),
    daysOfMonth: parseCronField(parts[2]!, 1, 31),
    months: parseCronField(parts[3]!, 1, 12),
    daysOfWeek: parseCronField(parts[4]!, 0, 6),
  };
}

/**
 * Check if a Date matches a parsed cron expression.
 */
function matchesCron(date: Date, fields: CronFields): boolean {
  return (
    fields.minutes.has(date.getMinutes()) &&
    fields.hours.has(date.getHours()) &&
    fields.daysOfMonth.has(date.getDate()) &&
    fields.months.has(date.getMonth() + 1) &&
    fields.daysOfWeek.has(date.getDay())
  );
}

/**
 * Calculate the next occurrence of a cron expression after `from`.
 * Searches forward minute-by-minute, up to 1 year.
 * Returns the Date of the next match.
 */
export function nextCronTime(expr: string, from: Date = new Date()): Date {
  const fields = parseCron(expr);

  // Start from next minute boundary
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  // Search forward (max ~1 year worth of minutes)
  const maxMinutes = 366 * 24 * 60;
  for (let i = 0; i < maxMinutes; i++) {
    if (matchesCron(next, fields)) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  throw new Error(`No matching cron time found within 1 year: ${expr}`);
}

/**
 * Calculate ms until the next cron occurrence.
 */
export function msUntilNextCron(expr: string, from: Date = new Date()): number {
  const next = nextCronTime(expr, from);
  return next.getTime() - from.getTime();
}
