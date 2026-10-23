import { describe, it } from 'node:test';
import assert from 'node:assert';
import { summarizeSamples, extractNumber, isWithinTolerance, type SamplePoint } from '../src/browser/sampler';

const point = (t: number, value: unknown, visibility = 'visible'): SamplePoint => ({ t, value, visibility });

describe('sampler', () => {
  describe('summarizeSamples', () => {
    it('summarizes numeric timelines', () => {
      const summary = summarizeSamples([
        point(0, 80),
        point(250, 78),
        point(500, 78),
        point(750, 82),
      ]);
      assert.strictEqual(summary.samples, 4);
      assert.strictEqual(summary.durationMs, 750);
      assert.strictEqual(summary.min, 78);
      assert.strictEqual(summary.max, 82);
      assert.deepStrictEqual(summary.numeric, [[0, 80], [250, 78], [500, 78], [750, 82]]);
      assert.strictEqual(summary.changes, 2);
    });

    it('extracts numbers via a key path', () => {
      const summary = summarizeSamples(
        [point(0, { top: 10, other: 'x' }), point(250, { top: 12 })],
        'top'
      );
      assert.strictEqual(summary.min, 10);
      assert.strictEqual(summary.max, 12);
    });

    it('counts string changes including hash removal', () => {
      const summary = summarizeSamples([
        point(0, '#listen'),
        point(250, '#listen'),
        point(500, ''),
        point(750, ''),
      ]);
      assert.strictEqual(summary.changes, 1);
      assert.strictEqual(summary.min, null);
      assert.deepStrictEqual(summary.numeric, []);
    });

    it('accumulates hidden time', () => {
      const summary = summarizeSamples([
        point(0, 1, 'visible'),
        point(250, 1, 'hidden'),
        point(500, 1, 'hidden'),
        point(750, 1, 'visible'),
      ]);
      assert.strictEqual(summary.hiddenMs, 500);
    });

    it('handles empty timelines', () => {
      const summary = summarizeSamples([]);
      assert.strictEqual(summary.samples, 0);
      assert.strictEqual(summary.first, null);
      assert.strictEqual(summary.min, null);
    });
  });

  describe('extractNumber', () => {
    it('reads plain numbers and nested keys', () => {
      assert.strictEqual(extractNumber(42), 42);
      assert.strictEqual(extractNumber('42'), null);
      assert.strictEqual(extractNumber({ a: { b: 7 } }, 'a.b'), 7);
      assert.strictEqual(extractNumber({ a: null }, 'a.b'), null);
      assert.strictEqual(extractNumber(Infinity), null);
    });
  });

  describe('isWithinTolerance', () => {
    it('compares numbers with tolerance', () => {
      assert.strictEqual(isWithinTolerance(78, 78.4, 1), true);
      assert.strictEqual(isWithinTolerance(78, 79.4, 1), false);
    });

    it('compares other values structurally', () => {
      assert.strictEqual(isWithinTolerance({ a: 1 }, { a: 1 }, 0), true);
      assert.strictEqual(isWithinTolerance('#home', '#contact', 0), false);
    });
  });
});
