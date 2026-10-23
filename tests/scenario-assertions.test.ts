import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateAssertion, resolvePath } from '../src/scenario/assertions';
import type { AssertStep } from '../src/scenario/schema';

const baseContext = () => ({
  vars: {
    top: { summary: { min: 77, max: 79, last: { value: { hash: '#contact-us' } } } },
    hash: '#contact-us',
  } as Record<string, unknown>,
  state: { url: 'https://preprod.example.com/#contact-us', title: 'Site', frames: 2 },
  globals: { setHashRestoreProtected: 'function', navigateToSectionId: 'undefined' } as Record<string, string>,
});

const step = (value: Partial<AssertStep>): AssertStep => ({ do: 'assert', ...value }) as AssertStep;

describe('scenario assertions', () => {
  it('resolves dot paths', () => {
    assert.strictEqual(resolvePath({ a: { b: 2 } }, 'a.b'), 2);
    assert.strictEqual(resolvePath({ a: 1 }, 'a.b'), undefined);
  });

  it('checks deployment fingerprints via globals and absent', () => {
    assert.strictEqual(
      evaluateAssertion(step({ globals: { setHashRestoreProtected: 'function' }, absent: ['navigateToSectionId'] }), baseContext()),
      null
    );
    assert.match(
      evaluateAssertion(step({ globals: { setHashRestoreProtected: 'undefined' } }), baseContext())!,
      /expected undefined, received function/
    );
    assert.match(
      evaluateAssertion(step({ absent: ['setHashRestoreProtected'] }), baseContext())!,
      /expected absent, received function/
    );
  });

  it('checks the final URL', () => {
    assert.strictEqual(evaluateAssertion(step({ url: '/preprod\\.example\\.com/' }), baseContext()), null);
    assert.match(evaluateAssertion(step({ url: '/nope/' }), baseContext())!, /does not match/);
  });

  it('checks saved variables and nested paths', () => {
    assert.strictEqual(evaluateAssertion(step({ on: 'hash', eq: '#contact-us' }), baseContext()), null);
    assert.strictEqual(
      evaluateAssertion(step({ on: 'top', path: 'summary.last.value.hash', eq: '#contact-us' }), baseContext()),
      null
    );
    assert.match(
      evaluateAssertion(step({ on: 'missing', eq: 1 }), baseContext())!,
      /unknown variable "missing"/
    );
  });

  it('applies numeric and string matchers', () => {
    assert.strictEqual(
      evaluateAssertion(step({ on: 'top', path: 'summary.min', within: { expected: 78, tolerance: 1 } }), baseContext()),
      null
    );
    assert.strictEqual(
      evaluateAssertion(step({ on: 'top', path: 'summary.max', min: 77, max: 80 }), baseContext()),
      null
    );
    assert.match(
      evaluateAssertion(step({ on: 'top', path: 'summary.min', within: { expected: 80, tolerance: 1 } }), baseContext())!,
      /expected 80 ±1, received 77/
    );
    assert.strictEqual(evaluateAssertion(step({ on: 'hash', match: 'contact' }), baseContext()), null);
  });

  it('checks live state paths', () => {
    assert.strictEqual(evaluateAssertion(step({ on: 'state', path: 'frames', eq: 2 }), baseContext()), null);
    assert.match(
      evaluateAssertion(step({ on: 'state', path: 'frames', eq: 3 }), baseContext())!,
      /expected 3, received 2/
    );
  });
});
