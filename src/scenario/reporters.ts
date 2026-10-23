import type { CaseResult } from './schema';

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'case';
}

export interface ScenarioSummary {
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  ok: boolean;
}

export function summarize(results: CaseResult[]): ScenarioSummary {
  const passed = results.filter(result => result.ok).length;
  const durationMs = results.reduce((total, result) => total + result.durationMs, 0);
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    durationMs,
    ok: passed === results.length,
  };
}

export function formatConsole(suiteName: string, results: CaseResult[]): string {
  const summary = summarize(results);
  const lines: string[] = [];
  for (const result of results) {
    const marker = result.ok ? 'PASS' : result.skipped ? 'SKIP' : 'FAIL';
    lines.push(`${marker} ${result.name} (${result.durationMs}ms)`);
    if (result.error) lines.push(`  ${result.error}`);
    for (const step of result.steps) {
      if (!step.ok) lines.push(`  step ${step.index + 1} (${step.action}): ${step.error}`);
    }
    if (result.artifactsDir) lines.push(`  artifacts: ${result.artifactsDir}`);
  }
  lines.push('');
  lines.push(
    `${suiteName}: ${summary.passed}/${summary.total} passed, ${summary.failed} failed in ${summary.durationMs}ms`
  );
  return lines.join('\n');
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function toJunit(suiteName: string, results: CaseResult[]): string {
  const summary = summarize(results);
  const cases = results
    .map(result => {
      const time = (result.durationMs / 1000).toFixed(3);
      const failureDetails = [
        result.error,
        ...result.steps.filter(step => !step.ok).map(step => `step ${step.index + 1} (${step.action}): ${step.error}`),
      ]
        .filter(Boolean)
        .join('\n');
      const body = result.ok
        ? ''
        : `<failure message="${escapeXml(result.error ?? 'scenario case failed')}">${escapeXml(failureDetails)}</failure>`;
      return `    <testcase classname="${escapeXml(suiteName)}" name="${escapeXml(result.name)}" time="${time}">${body}</testcase>`;
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${summary.total}" failures="${summary.failed}" time="${(summary.durationMs / 1000).toFixed(3)}">`,
    `  <testsuite name="${escapeXml(suiteName)}" tests="${summary.total}" failures="${summary.failed}" time="${(summary.durationMs / 1000).toFixed(3)}">`,
    cases,
    '  </testsuite>',
    '</testsuites>',
  ].join('\n');
}
