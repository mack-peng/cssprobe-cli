import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SocketConnection, compareSemver } from '../src/utils/socketConnection';

describe('socketConnection', () => {
  describe('compareSemver', () => {
    it('returns 0 for equal versions', () => {
      assert.strictEqual(compareSemver('1.0.0', '1.0.0'), 0);
      assert.strictEqual(compareSemver('2.5.3', '2.5.3'), 0);
    });

    it('returns 1 when first version is greater', () => {
      assert.strictEqual(compareSemver('2.0.0', '1.0.0'), 1);
      assert.strictEqual(compareSemver('1.1.0', '1.0.0'), 1);
      assert.strictEqual(compareSemver('1.0.1', '1.0.0'), 1);
    });

    it('returns -1 when first version is lesser', () => {
      assert.strictEqual(compareSemver('1.0.0', '2.0.0'), -1);
      assert.strictEqual(compareSemver('1.0.0', '1.1.0'), -1);
      assert.strictEqual(compareSemver('1.0.0', '1.0.1'), -1);
    });

    it('treats versions with suffix as equal base', () => {
      // Simplified compareSemver only compares base version (x.y.z)
      const result = compareSemver('1.0.0-alpha-2026-01-01', '1.0.0-alpha-2026-01-02');
      assert.strictEqual(result, 0);
    });

    it('compares base versions only', () => {
      // Simplified compareSemver only compares base version (x.y.z)
      const result = compareSemver('1.0.0', '1.0.0-alpha-2026-01-01');
      assert.strictEqual(result, 0);
    });
  });
});
