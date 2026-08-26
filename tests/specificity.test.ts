import { describe, it } from 'node:test';
import assert from 'node:assert';
import { specificity, pickWinning } from '../src/engine/specificity';

describe('specificity', () => {
  describe('specificity()', () => {
    it('inline has max specificity', () => {
      assert.strictEqual(specificity('inline'), Number.MAX_SAFE_INTEGER);
    });

    it('ranks id above class above type', () => {
      assert.ok(specificity('#foo') > specificity('.foo'));
      assert.ok(specificity('.foo') > specificity('div'));
      assert.ok(specificity('#foo') > specificity('div'));
    });

    it('counts multiple classes/attributes', () => {
      assert.ok(specificity('.a.b') > specificity('.a'));
      assert.ok(specificity('[type=text]') >= specificity('div'));
    });
  });

  describe('pickWinning()', () => {
    it('picks inline over rules', () => {
      const arr = [
        { selector: '.modal', value: '100%' },
        { selector: 'inline', value: '200px' },
      ];
      assert.strictEqual(pickWinning(arr).value, '200px');
    });

    it('picks higher specificity over lower', () => {
      const arr = [
        { selector: '.modal', value: '100%' },
        { selector: '#root .modal', value: '300px' },
      ];
      assert.strictEqual(pickWinning(arr).value, '300px');
    });

    it('picks the later rule on equal specificity', () => {
      const arr = [
        { selector: '.modal', value: '100%' },
        { selector: '.modal', value: '150px' },
      ];
      assert.strictEqual(pickWinning(arr).value, '150px');
    });

    it('returns the only element for single entry', () => {
      assert.strictEqual(pickWinning([{ selector: '.a', value: 'x' }]).value, 'x');
    });
  });
});