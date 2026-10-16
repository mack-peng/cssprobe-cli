import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveWaitTarget } from '../src/browser/interactions';

describe('interactions', () => {
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
