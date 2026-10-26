// Flow script runner: loads a user script in the daemon process, injects the
// interaction API, captures console output and returns a result envelope.

import path from 'path';
import util from 'util';
import { pathToFileURL } from 'url';
import type { BrowserContext, Page } from 'playwright-core';
import type { BrowserLauncher } from '../browser/launcher';
import {
  clickElement,
  hoverElement,
  typeInto,
  waitForCondition,
  type TargetResult,
  type TypeOptions,
  type WaitState,
} from '../browser/interactions';
import { analyze } from '../engine/analyzer';
import { renderMarkdown } from '../engine/renderer';
import { serializeEvalResult } from '../engine/evalSerializer';
import { saveScreenshotFile } from '../utils/screenshot';
import type { Finding, Snapshot } from '../engine/types';
import { describeFrames, resolveFrame, type FrameInfo } from '../browser/frames';
import { expect as expectValue, type Matchers } from './expect';

export interface FlowPageError {
  message: string;
  stack?: string;
}

export interface FlowEnvelope {
  ok: boolean;
  logs: string[];
  result?: unknown;
  error?: string;
  elapsedMs: number;
  pageErrors?: FlowPageError[];
}

export interface WaitForOptions {
  state?: WaitState;
  timeout?: number;
  frame?: string;
}

export interface WaitOutcome {
  waitedFor: 'selector' | 'js' | 'networkidle';
  state?: WaitState;
  elapsedMs: number;
}

export interface FlowApi {
  page: Page;
  context: BrowserContext;
  frames(): FrameInfo[];
  newPage(): Promise<Page>;
  expect(actual: unknown): Matchers;
  click(selector: string, opts?: { nth?: number; force?: boolean; timeout?: number }): Promise<TargetResult>;
  hover(selector: string, opts?: { nth?: number; force?: boolean; timeout?: number }): Promise<TargetResult>;
  type(selector: string, text: string, opts?: TypeOptions): Promise<void>;
  waitFor(
    target: string | { js: string; timeout?: number } | { networkIdle: true; timeout?: number },
    opts?: WaitForOptions
  ): Promise<WaitOutcome>;
  inspect(selector: string, opts?: { format?: 'json' | 'markdown' }): Promise<{ snapshot: Snapshot; findings: Finding[] } | string>;
  screenshot(opts?: { path?: string; fullPage?: boolean }): Promise<string>;
  log(...args: unknown[]): void;
}

type FlowFn = (api: FlowApi) => Promise<unknown> | unknown;

const FLOW_DEFAULT_TIMEOUT = 300_000;
const CAPTURED_CONSOLE_METHODS = ['log', 'info', 'warn', 'error'] as const;

// tsc compiles `import()` to `require()` under module=commonjs, which cannot
// load ESM scripts; a Function-constructed import keeps the native loader.
const nativeImport = new Function('p', 'return import(p)') as (p: string) => Promise<any>;

export async function loadFlowScript(absPath: string): Promise<FlowFn> {
  const mod = await nativeImport(`${pathToFileURL(absPath).href}?v=${Date.now()}`);
  const fn = mod?.default;
  if (typeof fn !== 'function')
    throw new Error(`Flow script must default-export an async function: ${absPath}`);
  return fn as FlowFn;
}

function captureConsole(logs: string[]): () => void {
  const originals = new Map<string, (...args: unknown[]) => void>();
  for (const method of CAPTURED_CONSOLE_METHODS) {
    originals.set(method, console[method] as (...args: unknown[]) => void);
    (console as unknown as Record<string, (...args: unknown[]) => void>)[method] = (...args: unknown[]) => {
      logs.push(`[${method}] ${util.format(...args)}`);
    };
  }
  return () => {
    for (const [method, original] of originals) {
      (console as unknown as Record<string, (...args: unknown[]) => void>)[method] = original;
    }
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer: NodeJS.Timeout;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Flow timed out after ${timeoutMs}ms (best-effort abort)`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

function requirePage(launcher: BrowserLauncher): Page {
  const page = launcher.getPage();
  if (!page) throw new Error('Browser is not open. Run: cssprobe-cli open <url>');
  return page;
}

async function flowWaitFor(
  page: Page,
  target: string | { js: string; timeout?: number } | { networkIdle: true; timeout?: number },
  opts?: WaitForOptions
): Promise<WaitOutcome> {
  const host = opts?.frame ? resolveFrame(page, opts.frame) : page;
  if (typeof target === 'string') {
    const state = opts?.state ?? 'visible';
    const timeout = opts?.timeout ?? 30_000;
    const elapsedMs = await waitForCondition(host, { kind: 'selector', selector: target, state }, timeout);
    return { waitedFor: 'selector', state, elapsedMs };
  }
  if ('js' in target) {
    const timeout = target.timeout ?? 30_000;
    const elapsedMs = await waitForCondition(host, { kind: 'js', expression: target.js }, timeout);
    return { waitedFor: 'js', elapsedMs };
  }
  if (target.networkIdle) {
    if (opts?.frame) throw new Error('networkIdle waits are page-level; remove opts.frame');
    const timeout = target.timeout ?? 30_000;
    const elapsedMs = await waitForCondition(host, { kind: 'networkIdle' }, timeout);
    return { waitedFor: 'networkidle', elapsedMs };
  }
  throw new Error('waitFor requires a selector string, { js }, or { networkIdle: true }');
}

function buildFlowApi(launcher: BrowserLauncher, logs: string[], baseDir: string): FlowApi {
  const page = requirePage(launcher);
  return {
    page,
    click: (selector, opts) => clickElement(page, selector, opts),
    hover: (selector, opts) => hoverElement(page, selector, opts),
    type: (selector, text, opts) => typeInto(page, selector, text, opts),
    waitFor: (target, opts) => flowWaitFor(page, target, opts),
    inspect: async (selector, opts) => {
      const snapshot = await launcher.collect({
        rootSelector: selector,
        downDepth: 6,
        maxNodes: 60,
        upTo: 'html',
      });
      const findings = analyze(snapshot);
      if (opts?.format === 'markdown') return renderMarkdown(snapshot, findings);
      return { snapshot, findings };
    },
    context: page.context(),
    frames: () => describeFrames(page),
    newPage: () => page.context().newPage(),
    expect: (actual) => expectValue(actual),
    screenshot: async (opts) => {
      const buffer = await page.screenshot({ fullPage: opts?.fullPage });
      const out = opts?.path ? path.resolve(baseDir, opts.path) : undefined;
      return saveScreenshotFile(`data:image/png;base64,${buffer.toString('base64')}`, out);
    },
    log: (...args) => {
      logs.push(util.format(...args));
    },
  };
}

function renderEnvelope(env: FlowEnvelope): string {
  const lines: string[] = [];
  if (env.ok) {
    lines.push(`Flow completed in ${env.elapsedMs}ms`);
    if (env.result !== undefined) lines.push(`Result: ${JSON.stringify(env.result, null, 2)}`);
  } else {
    lines.push(`Flow failed in ${env.elapsedMs}ms: ${env.error}`);
  }
  if (env.pageErrors?.length) {
    lines.push('', `Page errors (${env.pageErrors.length}):`);
    lines.push(...env.pageErrors.map(error => `  - ${error.message}`));
  }
  if (env.logs.length) {
    lines.push('', 'Logs:');
    lines.push(...env.logs.map(line => `  ${line}`));
  }
  return lines.join('\n');
}

export async function runFlow(
  launcher: BrowserLauncher,
  absPath: string,
  opts: { timeout?: number; json?: boolean } = {}
): Promise<{ text: string; exitCode: number }> {
  const logs: string[] = [];
  const started = Date.now();
  const restore = captureConsole(logs);
  const pageErrors: FlowPageError[] = [];
  const page = launcher.getPage();
  const onPageError = (error: Error) => {
    pageErrors.push({
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 6).join('\n'),
    });
  };
  page?.on('pageerror', onPageError);
  let env: FlowEnvelope;

  try {
    const fn = await loadFlowScript(absPath);
    const api = buildFlowApi(launcher, logs, path.dirname(absPath));
    const result = await withTimeout(Promise.resolve(fn(api)), opts.timeout ?? FLOW_DEFAULT_TIMEOUT);
    env = { ok: true, logs, elapsedMs: Date.now() - started };
    if (result !== undefined) env.result = serializeEvalResult(result);
  } catch (e) {
    env = { ok: false, logs, error: (e as Error).message, elapsedMs: Date.now() - started };
  } finally {
    page?.off('pageerror', onPageError);
    restore();
  }
  if (pageErrors.length) env.pageErrors = pageErrors;

  return {
    text: opts.json ? JSON.stringify(env, null, 2) : renderEnvelope(env),
    exitCode: env.ok ? 0 : 1,
  };
}
