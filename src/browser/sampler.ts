import type { Frame } from 'playwright-core';

export interface SamplePoint {
  t: number;
  value: unknown;
  visibility: string;
}

export interface SampleSummary {
  samples: number;
  durationMs: number;
  first: SamplePoint | null;
  last: SamplePoint | null;
  min: number | null;
  max: number | null;
  numeric: Array<[number, number]>;
  changes: number;
  hiddenMs: number;
}

export function extractNumber(value: unknown, key?: string): number | null {
  if (key) {
    let current: any = value;
    for (const part of key.split('.')) {
      if (current === null || current === undefined) return null;
      current = current[part];
    }
    return typeof current === 'number' && Number.isFinite(current) ? current : null;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function summarizeSamples(points: SamplePoint[], key?: string): SampleSummary {
  const numeric: Array<[number, number]> = [];
  for (const point of points) {
    const n = extractNumber(point.value, key);
    if (n !== null) numeric.push([point.t, n]);
  }

  let changes = 0;
  let hiddenMs = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && JSON.stringify(points[i].value) !== JSON.stringify(points[i - 1].value)) changes++;
    if (i < points.length - 1 && points[i].visibility !== 'visible') {
      hiddenMs += points[i + 1].t - points[i].t;
    }
  }

  return {
    samples: points.length,
    durationMs: points.length ? points[points.length - 1].t : 0,
    first: points[0] ?? null,
    last: points[points.length - 1] ?? null,
    min: numeric.length ? Math.min(...numeric.map(item => item[1])) : null,
    max: numeric.length ? Math.max(...numeric.map(item => item[1])) : null,
    numeric,
    changes,
    hiddenMs,
  };
}

export function isWithinTolerance(previous: unknown, next: unknown, tolerance: number): boolean {
  if (typeof previous === 'number' && typeof next === 'number') {
    if (Number.isNaN(previous) || Number.isNaN(next)) return false;
    return Math.abs(next - previous) <= tolerance;
  }
  return JSON.stringify(previous) === JSON.stringify(next);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function readValue(frame: Frame, expression: string): Promise<{ value: unknown; visibility: string }> {
  return frame.evaluate(
    `(async () => ({ value: await (${expression}), visibility: document.visibilityState }))()`
  ) as Promise<{ value: unknown; visibility: string }>;
}

export async function sampleFrame(
  frame: Frame,
  expression: string,
  opts: { intervalMs: number; durationMs: number }
): Promise<SamplePoint[]> {
  const intervalMs = Math.max(1, Math.floor(opts.intervalMs));
  const started = Date.now();
  const points: SamplePoint[] = [];

  while (Date.now() - started < opts.durationMs) {
    const t = Date.now() - started;
    const { value, visibility } = await readValue(frame, expression);
    points.push({ t, value, visibility });
    await sleep(intervalMs);
  }

  return points;
}

export async function waitForStableValue(
  frame: Frame,
  expression: string,
  opts: { toleranceMs?: number; windowMs?: number; timeoutMs?: number; intervalMs?: number; tolerance?: number }
): Promise<{ elapsedMs: number; value: unknown; samples: number }> {
  const intervalMs = Math.max(1, opts.intervalMs ?? 200);
  const windowMs = Math.max(1, opts.windowMs ?? 1500);
  const timeoutMs = Math.max(1, opts.timeoutMs ?? 30000);
  const tolerance = opts.tolerance ?? 0;
  const started = Date.now();

  let previous: unknown;
  let stableSince = started;
  let samples = 0;

  while (Date.now() - started < timeoutMs) {
    const { value } = await readValue(frame, expression);
    samples++;
    const now = Date.now();

    if (samples === 1 || !isWithinTolerance(previous, value, tolerance)) {
      previous = value;
      stableSince = now;
    } else if (now - stableSince >= windowMs) {
      return { elapsedMs: now - started, value, samples };
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `wait-stable timed out after ${timeoutMs}ms; last value: ${JSON.stringify(previous)}`
  );
}
