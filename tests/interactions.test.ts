import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveWaitTarget, normalizePredicateExpression, waitForCondition } from '../src/browser/interactions';

describe('interactions', () => {
  describe('normalizePredicateExpression', () => {
    it('calls arrow-function predicates', () => {
      assert.strictEqual(normalizePredicateExpression('() => ready'), '(() => ready)()');
      assert.strictEqual(normalizePredicateExpression('state => state.ok'), '(state => state.ok)()');
      assert.strictEqual(normalizePredicateExpression('async () => true'), '(async () => true)()');
    });

    it('calls function declarations', () => {
      assert.strictEqual(normalizePredicateExpression('function () { return true; }'), '(function () { return true; })()');
    });

    it('leaves bare expressions untouched', () => {
      assert.strictEqual(normalizePredicateExpression("document.readyState === 'complete'"), "document.readyState === 'complete'");
      assert.strictEqual(normalizePredicateExpression('window.ready'), 'window.ready');
    });
  });

  describe('waitForCondition', () => {
    it('rejects networkIdle when targeting a frame', async () => {
      await assert.rejects(waitForCondition({} as any, { kind: 'networkIdle' }, 10), /page-level/);
      const frameLike = { goto: async () => {}, waitForLoadState: async () => {} };
      await assert.rejects(waitForCondition(frameLike as any, { kind: 'networkIdle' }, 10), /page-level/);
    });
  });

  describe('resolveWaitTarget', () => {
    it('resolves a selector with default state visible', () => {
      assert.deepStrictEqual(resolveWaitTarget('.x', {}), {
        kind: 'selector',
        selector: '.x',
        state: 'visible',
      });
    });

    it('resolves a selector with an explicit state', () => {
      assert.deepStrictEqual(resolveWaitTarget('.x', { state: 'detached' }), {
        kind: 'selector',
        selector: '.x',
        state: 'detached',
      });
    });

    it('resolves a JS predicate', () => {
      assert.deepStrictEqual(resolveWaitTarget(undefined, { js: '() => ready' }), {
        kind: 'js',
        expression: '() => ready',
      });
    });

    it('resolves network idle', () => {
      assert.deepStrictEqual(resolveWaitTarget(undefined, { networkIdle: true }), {
        kind: 'networkIdle',
      });
    });

    it('rejects when no mode is given', () => {
      assert.throws(() => resolveWaitTarget(undefined, {}), /exactly one of/);
    });

    it('rejects when multiple modes are given', () => {
      assert.throws(() => resolveWaitTarget('.x', { js: '() => ready' }), /exactly one of/);
      assert.throws(() => resolveWaitTarget('.x', { networkIdle: true }), /exactly one of/);
      assert.throws(
        () => resolveWaitTarget(undefined, { js: '() => ready', networkIdle: true }),
        /exactly one of/
      );
    });
  });
});
