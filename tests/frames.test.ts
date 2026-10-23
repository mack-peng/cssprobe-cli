import { describe, it } from 'node:test';
import assert from 'node:assert';
import { selectFrame, formatFrames } from '../src/browser/frames';

class FakeFrame {
  constructor(private frameName: string, private frameUrl: string) {}
  name() { return this.frameName; }
  url() { return this.frameUrl; }
}

const frames = [
  new FakeFrame('', 'https://example.com/'),
  new FakeFrame('preview', 'https://example.com/i/preview?token=1'),
  new FakeFrame('preview', 'https://example.com/other'),
  new FakeFrame('map', 'https://maps.example.com/embed'),
];

describe('frames', () => {
  it('selects a frame by index', () => {
    assert.strictEqual(selectFrame(frames, '3'), frames[3]);
  });

  it('rejects an out-of-range index with the available frames', () => {
    assert.throws(() => selectFrame(frames, '9'), /out of range[\s\S]*\[0\]/);
  });

  it('selects a frame by URL substring', () => {
    assert.strictEqual(selectFrame(frames, 'i/preview'), frames[1]);
  });

  it('selects a frame by unique name', () => {
    assert.strictEqual(selectFrame(frames, 'map'), frames[3]);
  });

  it('reports ambiguous names', () => {
    assert.throws(() => selectFrame(frames, 'preview'), /ambiguous/);
  });

  it('reports ambiguous URL matches', () => {
    assert.throws(() => selectFrame(frames, 'example.com'), /matches multiple frames/);
  });

  it('reports unknown specs with the available frames', () => {
    assert.throws(() => selectFrame(frames, 'nope'), /No frame matches "nope"[\s\S]*\[0\]/);
  });

  it('formats frames for humans', () => {
    const text = formatFrames([
      { index: 0, name: '', url: 'https://example.com/', isMain: true },
      { index: 1, name: 'preview', url: 'https://example.com/i/preview', isMain: false },
    ]);
    assert.ok(text.includes('[0] (main) https://example.com/'));
    assert.ok(text.includes('[1] name="preview"'));
  });
});
