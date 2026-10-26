import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Frame, Page } from 'playwright-core';
import { BrowserLauncher } from '../browser/launcher';
import { describeFrames, resolveFrame } from '../browser/frames';
import { sampleFrame, summarizeSamples, waitForStableValue } from '../browser/sampler';
import { clickElement, waitForCondition } from '../browser/interactions';
import { serializeEvalResult } from '../engine/evalSerializer';
import { saveScreenshotFile } from '../utils/screenshot';
import { evaluateAssertion, type AssertionContext, type AssertionState } from './assertions';
import { slugify, summarize, toJunit, type ScenarioSummary } from './reporters';
import type { CaseResult, ScenarioCase, ScenarioRunOptions, Step, StepResult, Suite } from './schema';

export interface ScenarioRunResult {
  suite: string;
  ok: boolean;
  summary: ScenarioSummary;
  results: CaseResult[];
  artifactsDir: string;
}

async function evaluateValue(frame: Frame, expression: string): Promise<unknown> {
  const handle = await frame.evaluateHandle(expression);
  try {
    const resolved = await handle.evaluateHandle((value) => Promise.resolve(value));
    try {
      return await resolved.evaluate(serializeEvalResult);
    } finally {
      await resolved.dispose();
    }
  } finally {
    await handle.dispose();
  }
}

async function readState(page: Page): Promise<AssertionState> {
  return { url: page.url(), title: await page.title(), frames: describeFrames(page).length };
}

async function readGlobals(page: Page, names: string[]): Promise<Record<string, string>> {
  if (!names.length) return {};
  return page.evaluate((list: string[]) => {
    const out: Record<string, string> = {};
    for (const name of list) {
      let current: any = window;
      for (const part of name.split('.')) {
        if (current === null || current === undefined) {
          current = undefined;
          break;
        }
        current = current[part];
      }
      out[name] = typeof current;
    }
    return out;
  }, names);
}

function stepLabel(step: Step): string {
  return step.do;
}

function resolveCaseState(suiteDir: string, caseState: string | undefined, defaultsState: string | undefined, cliState: string | undefined): string | undefined {
  if (caseState) return path.resolve(suiteDir, caseState);
  if (defaultsState) return path.resolve(suiteDir, defaultsState);
  return cliState ? path.resolve(process.cwd(), cliState) : undefined;
}

function caseDirectory(root: string, index: number, name: string): string {
  const dir = path.join(root, `${String(index + 1).padStart(2, '0')}-${slugify(name)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function runScenario(
  suite: Suite,
  suitePath: string,
  options: ScenarioRunOptions = {}
): Promise<ScenarioRunResult> {
  const suiteDir = path.dirname(path.resolve(suitePath));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactsDir =
    options.artifactsDir ??
    path.join(os.homedir(), '.cssprobe-cli', 'scenario-runs', `${slugify(suite.name)}-${stamp}`);
  fs.mkdirSync(artifactsDir, { recursive: true });

  const results: CaseResult[] = [];

  for (const [caseIndex, scenarioCase] of suite.cases.entries()) {
    const caseDir = caseDirectory(artifactsDir, caseIndex, scenarioCase.name);
    const result: CaseResult = {
      name: scenarioCase.name,
      ok: false,
      durationMs: 0,
      steps: [],
      artifactsDir: caseDir,
    };

    const started = Date.now();
    const launcher = new BrowserLauncher({
      browser: options.browser,
      headed: options.headed,
      viewport: options.viewport ?? suite.defaults?.viewport,
      state: resolveCaseState(suiteDir, scenarioCase.state, suite.defaults?.state, options.state),
    });

    const vars: Record<string, unknown> = {};

    try {
      const url = scenarioCase.url ?? suite.defaults?.url ?? 'about:blank';
      await launcher.open(url);
      const page = launcher.getPage();
      if (!page) throw new Error('Browser page is not available');

      for (const [stepIndex, step] of scenarioCase.steps.entries()) {
        const stepStarted = Date.now();
        const stepResult: StepResult = {
          index: stepIndex,
          action: stepLabel(step),
          ok: false,
          durationMs: 0,
        };
        try {
          await executeStep(step, {
            page,
            vars,
            frameSpec: scenarioCase.frame ?? suite.defaults?.frame,
            caseDir,
            stepIndex,
          });
          stepResult.ok = true;
          if ('save' in step && step.save) stepResult.saved = step.save;
        } catch (error) {
          stepResult.error = (error as Error).message;
          await page
            .screenshot({ path: path.join(caseDir, `failure-step-${stepIndex + 1}.png`) })
            .catch(() => {});
          throw error;
        } finally {
          stepResult.durationMs = Date.now() - stepStarted;
          result.steps.push(stepResult);
        }
      }

      result.ok = true;
    } catch (error) {
      result.ok = false;
      result.error = (error as Error).message;
    } finally {
      result.durationMs = Date.now() - started;
      fs.writeFileSync(path.join(caseDir, 'case.json'), JSON.stringify(result, null, 2));
      await launcher.close().catch(() => {});
    }

    results.push(result);
    if (!result.ok && options.bail) break;
  }

  const summary = summarize(results);
  const runResult: ScenarioRunResult = { suite: suite.name, ok: summary.ok, summary, results, artifactsDir };

  fs.writeFileSync(path.join(artifactsDir, 'summary.json'), JSON.stringify(runResult, null, 2));
  if (options.junitPath) {
    fs.mkdirSync(path.dirname(path.resolve(options.junitPath)), { recursive: true });
    fs.writeFileSync(path.resolve(options.junitPath), require('./reporters').toJunit(suite.name, results), 'utf-8');
  }

  return runResult;
}

interface ExecuteContext {
  page: Page;
  vars: Record<string, unknown>;
  frameSpec?: string;
  caseDir: string;
  stepIndex: number;
}

async function executeStep(step: Step, context: ExecuteContext): Promise<void> {
  const { page, vars, caseDir, stepIndex } = context;

  switch (step.do) {
    case 'goto': {
      await page.goto(step.url, { waitUntil: step.waitUntil ?? 'domcontentloaded', timeout: 60000 });
      if (step.save) vars[step.save] = await readState(page);
      return;
    }
    case 'reload': {
      await page.reload({ waitUntil: step.waitUntil ?? 'domcontentloaded', timeout: 60000 });
      if (step.save) vars[step.save] = await readState(page);
      return;
    }
    case 'eval': {
      const frame = resolveFrame(page, step.frame ?? context.frameSpec);
      const value = await evaluateValue(frame, step.expression);
      if (step.save) vars[step.save] = value;
      return;
    }
    case 'sample': {
      const frame = resolveFrame(page, step.frame ?? context.frameSpec);
      const points = await sampleFrame(frame, step.expression, {
        intervalMs: step.interval ?? 250,
        durationMs: step.duration ?? 5000,
        ignoreErrors: step.ignoreErrors,
      });
      const summary = summarizeSamples(points, step.key, 5000, step.tailFrom);
      const value = { expression: step.expression, summary, series: points };
      if (step.save) vars[step.save] = value;
      fs.writeFileSync(
        path.join(caseDir, `step-${stepIndex + 1}-${step.save ?? 'sample'}-series.json`),
        JSON.stringify(value, null, 2)
      );
      return;
    }
    case 'waitStable': {
      const frame = resolveFrame(page, step.frame ?? context.frameSpec);
      const value = await waitForStableValue(frame, step.expression, {
        tolerance: step.tolerance,
        windowMs: step.window,
        timeoutMs: step.timeout,
        intervalMs: step.interval,
      });
      if (step.save) vars[step.save] = value;
      return;
    }
    case 'click': {
      await clickElement(page, step.selector, { nth: step.nth, timeout: step.timeout });
      return;
    }
    case 'waitFor': {
      const timeout = step.timeout ?? 30000;
      const frameSpec = step.frame ?? context.frameSpec;
      if (step.networkIdle) {
        if (frameSpec) throw new Error('networkIdle waits are page-level; remove frame');
        await waitForCondition(page, { kind: 'networkIdle' }, timeout);
      } else if (step.js) {
        await waitForCondition(frameSpec ? resolveFrame(page, frameSpec) : page, { kind: 'js', expression: step.js }, timeout);
      } else if (step.selector) {
        await waitForCondition(
          frameSpec ? resolveFrame(page, frameSpec) : page,
          { kind: 'selector', selector: step.selector, state: step.state ?? 'visible' },
          timeout
        );
      } else {
        throw new Error('waitFor requires selector, js, or networkIdle');
      }
      return;
    }
    case 'wait': {
      await new Promise(resolve => setTimeout(resolve, step.ms));
      return;
    }
    case 'screenshot': {
      const buffer = await page.screenshot({ fullPage: step.fullPage });
      const out = path.resolve(caseDir, step.path ?? `step-${stepIndex + 1}-screenshot.png`);
      saveScreenshotFile(`data:image/png;base64,${buffer.toString('base64')}`, out);
      return;
    }
    case 'assert': {
      const names = [...Object.keys(step.globals ?? {}), ...(step.absent ?? [])];
      const assertionContext: AssertionContext = {
        vars,
        state: await readState(page),
        globals: await readGlobals(page, names),
      };
      const error = evaluateAssertion(step, assertionContext);
      if (error) throw new Error(error);
      return;
    }
  }
}
