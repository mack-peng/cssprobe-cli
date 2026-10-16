import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { loadFlowScript } from '../src/daemon/flowRunner';

const flowsDir = path.join(__dirname, 'fixtures', 'flows');

describe('flowRunner', () => {
  describe('loadFlowScript', () => {
    it('loads an ESM script with a default-exported function', async () => {
      const fn = await loadFlowScript(path.join(flowsDir, 'good.mjs'));
      assert.strictEqual(typeof fn, 'function');
    });

    it('loads a CJS script exporting a function', async () => {
      const fn = await loadFlowScript(path.join(flowsDir, 'good.cjs'));
      assert.strictEqual(typeof fn, 'function');
    });

    it('rejects a script without a default export', async () => {
      await assert.rejects(
        loadFlowScript(path.join(flowsDir, 'no-default.mjs')),
        /must default-export an async function/
      );
    });

    it('rejects a missing script file', async () => {
      await assert.rejects(loadFlowScript(path.join(flowsDir, 'missing.mjs')));
    });
  });
});
