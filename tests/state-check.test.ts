import { describe, it } from 'node:test';
import assert from 'node:assert';
import { analyzeState } from '../src/cli/state-check';

const now = 1_800_000_000_000;

describe('state-check', () => {
  it('reports cookies, domains and session cookies', () => {
    const report = analyzeState(
      {
        cookies: [
          { name: 'a', domain: '.example.com', expires: now / 1000 + 100 },
          { name: 'b', domain: 'preprod.example.com', expires: -1 },
        ],
      },
      'https://preprod.example.com/',
      now
    );
    assert.strictEqual(report.cookies, 2);
    assert.strictEqual(report.sessionCookies, 1);
    assert.deepStrictEqual(report.domains, ['example.com', 'preprod.example.com']);
    assert.strictEqual(report.targetMatches, true);
    assert.strictEqual(report.ok, true);
  });

  it('flags expired cookies', () => {
    const report = analyzeState(
      { cookies: [{ name: 'old', domain: 'example.com', expires: now / 1000 - 10 }] },
      undefined,
      now
    );
    assert.deepStrictEqual(report.expired, ['old']);
    assert.strictEqual(report.ok, false);
    assert.ok(report.warnings.some(w => w.includes('expired')));
  });

  it('flags target domains without matching cookies', () => {
    const report = analyzeState(
      { cookies: [{ name: 'a', domain: 'other.com', expires: now / 1000 + 100 }] },
      'https://example.com/',
      now
    );
    assert.strictEqual(report.targetMatches, false);
    assert.strictEqual(report.ok, false);
  });

  it('handles empty state files', () => {
    const report = analyzeState({}, undefined, now);
    assert.strictEqual(report.cookies, 0);
    assert.strictEqual(report.ok, false);
    assert.ok(report.warnings.some(w => w.includes('no cookies')));
  });

  it('rejects invalid target URLs', () => {
    assert.throws(() => analyzeState({ cookies: [] }, 'nope', now), /Invalid --url/);
  });
});
