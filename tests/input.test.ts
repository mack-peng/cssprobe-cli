import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveInputArg } from '../src/cli/input';

describe('resolveInputArg', () => {
  it('passes through inline values', () => {
    assert.strictEqual(resolveInputArg('({a: 1})'), '({a: 1})');
  });

  it('reads @file relative to the working directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cssprobe-input-'));
    const file = path.join(dir, 'expr.js');
    fs.writeFileSync(file, '({a: 1})');
    assert.strictEqual(resolveInputArg(`@${file}`), '({a: 1})');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports a missing file with the resolved path', () => {
    const missing = path.join(os.tmpdir(), 'cssprobe-missing-expr.js');
    assert.throws(() => resolveInputArg(`@${missing}`), new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('reads "-" from stdin', () => {
    assert.strictEqual(
      resolveInputArg('-', { readStdin: () => 'location.hash' }),
      'location.hash'
    );
  });

  it('uses injected sources', () => {
    assert.strictEqual(
      resolveInputArg('@expr.js', {
        exists: () => true,
        readFile: (file) => `read:${path.basename(file)}`,
      }),
      'read:expr.js'
    );
  });
});
