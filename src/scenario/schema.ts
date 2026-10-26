import * as z from 'zod';

const waitUntil = z.enum(['domcontentloaded', 'load', 'networkidle']).optional();

const matcherFields = {
  eq: z.unknown().optional(),
  ne: z.unknown().optional(),
  match: z.string().optional(),
  within: z.object({ expected: z.number(), tolerance: z.number() }).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
};

const gotoStep = z.object({
  do: z.literal('goto'),
  url: z.string(),
  waitUntil,
  save: z.string().optional(),
});

const reloadStep = z.object({
  do: z.literal('reload'),
  waitUntil,
  save: z.string().optional(),
});

const evalStep = z.object({
  do: z.literal('eval'),
  expression: z.string(),
  frame: z.string().optional(),
  save: z.string().optional(),
});

const sampleStep = z.object({
  do: z.literal('sample'),
  expression: z.string(),
  interval: z.number().optional(),
  duration: z.number().optional(),
  key: z.string().optional(),
  tailFrom: z.number().optional(),
  ignoreErrors: z.boolean().optional(),
  frame: z.string().optional(),
  save: z.string().optional(),
});

const waitStableStep = z.object({
  do: z.literal('waitStable'),
  expression: z.string(),
  tolerance: z.number().optional(),
  window: z.number().optional(),
  timeout: z.number().optional(),
  interval: z.number().optional(),
  frame: z.string().optional(),
  save: z.string().optional(),
});

const clickStep = z.object({
  do: z.literal('click'),
  selector: z.string(),
  nth: z.number().optional(),
  timeout: z.number().optional(),
});

const waitForStep = z.object({
  do: z.literal('waitFor'),
  selector: z.string().optional(),
  js: z.string().optional(),
  networkIdle: z.boolean().optional(),
  state: z.enum(['visible', 'hidden', 'attached', 'detached']).optional(),
  frame: z.string().optional(),
  timeout: z.number().optional(),
});

const waitStep = z.object({
  do: z.literal('wait'),
  ms: z.number().positive(),
});

const screenshotStep = z.object({
  do: z.literal('screenshot'),
  path: z.string().optional(),
  fullPage: z.boolean().optional(),
});

const assertStep = z.object({
  do: z.literal('assert'),
  label: z.string().optional(),
  on: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
  globals: z.record(z.string(), z.string()).optional(),
  absent: z.array(z.string()).optional(),
  ...matcherFields,
});

export const stepSchema = z.discriminatedUnion('do', [
  gotoStep,
  reloadStep,
  evalStep,
  sampleStep,
  waitStableStep,
  clickStep,
  waitForStep,
  waitStep,
  screenshotStep,
  assertStep,
]);

const viewportSchema = z.object({ width: z.number(), height: z.number() });

export const caseSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
  state: z.string().optional(),
  frame: z.string().optional(),
  steps: z.array(stepSchema).min(1),
});

export const suiteSchema = z.object({
  name: z.string(),
  defaults: z
    .object({
      url: z.string().optional(),
      state: z.string().optional(),
      frame: z.string().optional(),
      viewport: viewportSchema.optional(),
    })
    .optional(),
  cases: z.array(caseSchema).min(1),
});

export type Suite = z.infer<typeof suiteSchema>;
export type ScenarioCase = z.infer<typeof caseSchema>;
export type Step = z.infer<typeof stepSchema>;
export type AssertStep = z.infer<typeof assertStep>;

export interface ScenarioRunOptions {
  artifactsDir?: string;
  junitPath?: string;
  bail?: boolean;
  headed?: boolean;
  browser?: string;
  viewport?: { width: number; height: number };
  state?: string;
}

export interface StepResult {
  index: number;
  action: string;
  ok: boolean;
  durationMs: number;
  error?: string;
  saved?: string;
}

export interface CaseResult {
  name: string;
  ok: boolean;
  durationMs: number;
  skipped?: boolean;
  steps: StepResult[];
  error?: string;
  artifactsDir?: string;
}
