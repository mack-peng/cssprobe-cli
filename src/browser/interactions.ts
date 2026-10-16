// Interaction primitives shared by daemon commands and the run-script API.
// Strict mode is preserved when no nth is given: multiple matches fail the action.

import type { Locator, Page } from 'playwright-core';

export interface ElementDescriptor {
  tag: string;
  classes: string[];
  text: string;
}

export interface TargetResult {
  matches: number;
  nth: number;
  descriptor: ElementDescriptor | null;
}

export type WaitState = 'visible' | 'hidden' | 'attached' | 'detached';

export type WaitTarget =
  | { kind: 'selector'; selector: string; state: WaitState }
  | { kind: 'js'; expression: string }
  | { kind: 'networkIdle' };

const DEFAULT_TIMEOUT = 30_000;

function resolveLocator(page: Page, selector: string, nth?: number): Locator {
  const base = page.locator(selector);
  return nth ? base.nth(nth - 1) : base;
}

async function describeTarget(locator: Locator): Promise<ElementDescriptor | null> {
  return await locator
    .evaluate(el => ({
      tag: el.tagName.toLowerCase(),
      classes: Array.from(el.classList),
      text: (el.textContent ?? '').trim().slice(0, 60),
    }))
    .catch(() => null);
}

async function interactTarget(
  page: Page,
  selector: string,
  opts: { nth?: number; force?: boolean; timeout?: number },
  action: (locator: Locator, opts: { force?: boolean; timeout: number }) => Promise<void>
): Promise<TargetResult> {
  const base = page.locator(selector);
  const locator = resolveLocator(page, selector, opts.nth);
  const matches = await base.count();
  const descriptor = await describeTarget(locator);
  await action(locator, { force: opts.force, timeout: opts.timeout ?? DEFAULT_TIMEOUT });
  return { matches, nth: opts.nth ?? 1, descriptor };
}

export async function clickElement(
  page: Page,
  selector: string,
  opts: { nth?: number; force?: boolean; timeout?: number } = {}
): Promise<TargetResult> {
  return interactTarget(page, selector, opts, (locator, o) =>
    locator.click({ force: o.force, timeout: o.timeout })
  );
}

export async function hoverElement(
  page: Page,
  selector: string,
  opts: { nth?: number; force?: boolean; timeout?: number } = {}
): Promise<TargetResult> {
  return interactTarget(page, selector, opts, (locator, o) =>
    locator.hover({ force: o.force, timeout: o.timeout })
  );
}

export interface TypeOptions {
  press?: string;
  sequential?: boolean;
  clear?: boolean;
  delay?: number;
  nth?: number;
  timeout?: number;
}

export async function typeInto(
  page: Page,
  selector: string,
  text: string,
  opts: TypeOptions = {}
): Promise<void> {
  const locator = resolveLocator(page, selector, opts.nth);
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;

  if (opts.sequential) {
    if (opts.clear) await locator.fill('', { timeout });
    await locator.pressSequentially(text, { delay: opts.delay ?? 0, timeout });
  } else {
    await locator.fill(text, { timeout });
  }

  if (opts.press) await locator.press(opts.press, { timeout });
}

export function describeWaitTarget(target: WaitTarget): string {
  switch (target.kind) {
    case 'selector':
      return `${target.selector} (state: ${target.state})`;
    case 'js':
      return `JS predicate: ${target.expression.slice(0, 80)}`;
    case 'networkIdle':
      return 'network idle';
  }
}

export function resolveWaitTarget(
  selector: string | undefined,
  opts: { js?: string; networkIdle?: boolean; state?: string }
): WaitTarget {
  const modeCount = [selector, opts.js, opts.networkIdle].filter(Boolean).length;
  if (modeCount !== 1)
    throw new Error('wait-for requires exactly one of: <selector>, --js "<expression>", --network-idle');
  if (selector) return { kind: 'selector', selector, state: (opts.state ?? 'visible') as WaitState };
  if (opts.js) return { kind: 'js', expression: opts.js };
  return { kind: 'networkIdle' };
}

export async function waitForCondition(
  page: Page,
  target: WaitTarget,
  timeout: number
): Promise<number> {
  const started = Date.now();
  switch (target.kind) {
    case 'selector':
      await page.waitForSelector(target.selector, { state: target.state, timeout });
      break;
    case 'js':
      await page.waitForFunction(target.expression, null, { timeout });
      break;
    case 'networkIdle':
      await page.waitForLoadState('networkidle', { timeout });
      break;
  }
  return Date.now() - started;
}
