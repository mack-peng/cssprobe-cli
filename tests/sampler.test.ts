import { describe, it } from 'node:test';
import assert from 'node:assert';
import { summarizeSamples, extractNumber, isWithinTolerance, sampleFrame, type SamplePoint } from '../src/browser/sampler';

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
      assert.deepStrictEqual(summary.tail, { fromT: 0, min: 78, max: 82, windowMs: 5000 });
    });

    it('computes a tail window for late assertions', () => {
      const summary = summarizeSamples([
        point(0, 7000),
        point(6000, 78),
        point(6500, 79),
      ], undefined, 1000);
      assert.strictEqual(summary.min, 78);
      assert.strictEqual(summary.max, 7000);
      assert.deepStrictEqual(summary.tail, { fromT: 5500, min: 78, max: 79, windowMs: 1000 });
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

  it('supports an absolute tail start', () => {
      const summary = summarizeSamples([point(0, 7000), point(6000, 78), point(6500, 79)], undefined, 5000, 6000);
      assert.deepStrictEqual(summary.tail, { fromT: 6000, min: 78, max: 79, windowMs: 5000 });
    });

  describe('sampleFrame', () => {
    it('aborts on evaluation errors by default', async () => {
      const frame = { evaluate: async () => { throw new Error('boom'); } } as any;
      await assert.rejects(sampleFrame(frame, 'x', { intervalMs: 1, durationMs: 10 }), /boom/);
    });

    it('records evaluation errors when ignoreErrors is set', async () => {
      let calls = 0;
      const frame = {
        evaluate: async () => {
          calls += 1;
          if (calls === 1) throw new Error('boom');
          return { value: 1, visibility: 'visible' };
        },
      } as any;
      const points = await sampleFrame(frame, 'x', { intervalMs: 1, durationMs: 40, ignoreErrors: true });
      assert.strictEqual(points[0].error, 'boom');
      assert.strictEqual(points[0].value, null);
      assert.ok(points.some(item => item.value === 1));
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
