import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TextOutput, JsonOutput } from '../src/cli/output';

describe('output', () => {
  describe('TextOutput', () => {
    it('formats objects as indented JSON', () => {
      const output = new TextOutput();
      const result = output.format({ key: 'value', num: 42 });
      assert.ok(result.includes('"key": "value"'));
      assert.ok(result.includes('"num": 42'));
    });

    it('formats arrays as table', () => {
      const output = new TextOutput();
      const result = output.format([{ name: 'test', count: 5 }, { name: 'other', count: 10 }]);
      assert.ok(result.includes('name'));
      assert.ok(result.includes('count'));
      assert.ok(result.includes('test'));
      assert.ok(result.includes('other'));
    });

    it('formats empty array as empty list', () => {
      const output = new TextOutput();
      assert.strictEqual(output.format([]), '(empty list)');
    });

    it('formats null/undefined as empty', () => {
      const output = new TextOutput();
      assert.strictEqual(output.format(null), '(empty)');
      assert.strictEqual(output.format(undefined), '(empty)');
    });

    it('formats strings directly', () => {
      const output = new TextOutput();
      assert.strictEqual(output.format('hello'), 'hello');
    });

    it('raw mode returns JSON string for objects', () => {
      const output = new TextOutput(true);
      const result = output.format({ key: 'value' });
      assert.strictEqual(result, '{"key":"value"}');
    });

    it('json property is false', () => {
      const output = new TextOutput();
      assert.strictEqual(output.json, false);
    });
  });

  describe('JsonOutput', () => {
    it('formats as indented JSON', () => {
      const output = new JsonOutput();
      const result = output.format({ key: 'value' });
      assert.strictEqual(result, '{\n  "key": "value"\n}');
    });

    it('json property is true', () => {
      const output = new JsonOutput();
      assert.strictEqual(output.json, true);
    });
  });
});
