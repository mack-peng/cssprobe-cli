import { describe, it } from 'node:test';
import assert from 'node:assert';
import { slugify, summarize, formatConsole, toJunit, escapeXml } from '../src/scenario/reporters';
import type { CaseResult } from '../src/scenario/schema';

const results: CaseResult[] = [
  { name: 'refresh #listen', ok: true, durationMs: 1000, steps: [], artifactsDir: '/tmp/a' },
  {
    name: 'new tab #contact',
    ok: false,
    durationMs: 500,
    error: 'top 82 < 78',
    steps: [{ index: 0, action: 'sample', ok: false, durationMs: 500, error: 'assert failed' }],
  },
];

describe('scenario reporters', () => {
  it('slugifies case names', () => {
    assert.strictEqual(slugify('Refresh #listen-to-tcmi!'), 'refresh-listen-to-tcmi');
    assert.strictEqual(slugify('***'), 'case');
  });

  it('summarizes runs', () => {
    assert.deepStrictEqual(summarize(results), {
      total: 2,
      passed: 1,
      failed: 1,
      durationMs: 1500,
      ok: false,
    });
  });

  it('formats console output with failures and artifacts', () => {
    const text = formatConsole('ticket 26571394', results);
    assert.ok(text.includes('PASS refresh #listen'));
    assert.ok(text.includes('FAIL new tab #contact'));
    assert.ok(text.includes('step 1 (sample): assert failed'));
    assert.ok(text.includes('1/2 passed, 1 failed'));
  });

  it('escapes XML and emits JUnit', () => {
    assert.strictEqual(escapeXml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
    const xml = toJunit('suite & co', results);
    assert.ok(xml.includes('<testsuite name="suite &amp; co" tests="2" failures="1"'));
    assert.ok(xml.includes('<failure message="top 82 &lt; 78">'));
    assert.ok(xml.includes('name="refresh #listen"'));
  });
});
