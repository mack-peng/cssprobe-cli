import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as z from 'zod';
import { declareCommand, parseCommand } from '../src/cli/command';

const numberArg = z.preprocess((val, ctx) => {
  const n = Number(val);
  if (Number.isNaN(n)) {
    ctx.addIssue({ code: 'custom', message: `expected number` });
  }
  return n;
}, z.number());

describe('command', () => {
  describe('declareCommand', () => {
    it('returns the command schema unchanged', () => {
      const cmd = declareCommand({
        name: 'test',
        category: 'core',
        description: 'test command',
      });
      assert.strictEqual(cmd.name, 'test');
      assert.strictEqual(cmd.category, 'core');
    });
  });

  describe('parseCommand', () => {
    it('parses positional args', () => {
      const cmd = declareCommand({
        name: 'inspect',
        category: 'core',
        description: 'inspect page',
        args: z.object({ url: z.string() }),
      });
      const result = parseCommand(cmd, { _: ['inspect', 'https://example.com'] });
      assert.strictEqual(result.url, 'https://example.com');
    });

    it('parses optional positional args', () => {
      const cmd = declareCommand({
        name: 'inspect',
        category: 'core',
        description: 'inspect page',
        args: z.object({
          url: z.string(),
          selector: z.string().optional(),
        }),
      });
      const result = parseCommand(cmd, { _: ['inspect', 'https://example.com', '.my-class'] });
      assert.strictEqual(result.url, 'https://example.com');
      assert.strictEqual(result.selector, '.my-class');
    });

    it('parses provided options', () => {
      const cmd = declareCommand({
        name: 'inspect',
        category: 'core',
        description: 'inspect page',
        args: z.object({ url: z.string() }),
        options: z.object({ json: z.boolean().optional() }),
      });
      const result = parseCommand(cmd, { _: ['inspect', 'https://example.com'], json: true });
      assert.strictEqual(result.json, true);
    });

    it('rejects unknown options (strict)', () => {
      const cmd = declareCommand({
        name: 'inspect',
        category: 'core',
        description: 'inspect page',
        options: z.object({ json: z.boolean().optional() }),
      });
      assert.throws(() => parseCommand(cmd, { _: ['inspect'], bogus: 'x' }), /unknown/i);
    });

    it('rejects too many positional args', () => {
      const cmd = declareCommand({
        name: 'inspect',
        category: 'core',
        description: 'inspect page',
        args: z.object({ url: z.string() }),
      });
      assert.throws(() => parseCommand(cmd, { _: ['inspect', 'a', 'b', 'c'] }), /too many arguments/);
    });

    it('rejects invalid number arg', () => {
      const cmd = declareCommand({
        name: 'inspect',
        category: 'core',
        description: 'inspect page',
        args: z.object({ depth: numberArg }),
      });
      assert.throws(() => parseCommand(cmd, { _: ['inspect', 'abc'] }), /expected number/);
    });
  });
});
