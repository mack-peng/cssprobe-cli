import { describe, it } from 'node:test';
import assert from 'node:assert';
import { commands } from '../src/cli/commands';
import { parseCommand } from '../src/cli/command';

describe('interaction commands', () => {
  describe('click', () => {
    it('parses selector and options', () => {
      const parsed = parseCommand(commands['click'], {
        _: ['click', '.btn'],
        nth: 2,
        force: true,
        timeout: 5000,
      });
      assert.strictEqual(parsed.selector, '.btn');
      assert.strictEqual(parsed.nth, 2);
      assert.strictEqual(parsed.force, true);
      assert.strictEqual(parsed.timeout, 5000);
    });

    it('requires a selector', () => {
      assert.throws(() => parseCommand(commands['click'], { _: ['click'] }));
    });

    it('rejects unknown options', () => {
      assert.throws(() => parseCommand(commands['click'], { _: ['click', '.btn'], bogus: true }), /unknown/i);
    });
  });

  describe('hover', () => {
    it('parses without options', () => {
      const parsed = parseCommand(commands['hover'], { _: ['hover', '.card'] });
      assert.strictEqual(parsed.selector, '.card');
      assert.strictEqual(parsed.nth, undefined);
    });
  });

  describe('type', () => {
    it('parses selector, text and flags', () => {
      const parsed = parseCommand(commands['type'], {
        _: ['type', '#input', 'hello'],
        press: 'Enter',
        sequential: true,
        clear: true,
        delay: 20,
      });
      assert.strictEqual(parsed.selector, '#input');
      assert.strictEqual(parsed.text, 'hello');
      assert.strictEqual(parsed.press, 'Enter');
      assert.strictEqual(parsed.sequential, true);
      assert.strictEqual(parsed.clear, true);
      assert.strictEqual(parsed.delay, 20);
    });

    it('requires text', () => {
      assert.throws(() => parseCommand(commands['type'], { _: ['type', '#input'] }));
    });
  });

  describe('wait-for', () => {
    it('parses a selector target', () => {
      const parsed = parseCommand(commands['wait-for'], {
        _: ['wait-for', '.modal'],
        state: 'visible',
        timeout: 5000,
      });
      assert.strictEqual(parsed.selector, '.modal');
      assert.strictEqual(parsed.state, 'visible');
      assert.strictEqual(parsed.timeout, 5000);
    });

    it('parses a JS predicate target', () => {
      const parsed = parseCommand(commands['wait-for'], {
        _: ['wait-for'],
        js: '() => ready === true',
      });
      assert.strictEqual(parsed.js, '() => ready === true');
    });

    it('parses network idle target', () => {
      const parsed = parseCommand(commands['wait-for'], {
        _: ['wait-for'],
        'network-idle': true,
      });
      assert.strictEqual(parsed['network-idle'], true);
    });

    it('rejects an invalid state', () => {
      assert.throws(() =>
        parseCommand(commands['wait-for'], { _: ['wait-for', '.x'], state: 'flying' })
      );
    });
  });

  describe('run', () => {
    it('parses file and timeout', () => {
      const parsed = parseCommand(commands['run'], {
        _: ['run', './flow.js'],
        timeout: 0,
      });
      assert.strictEqual(parsed.file, './flow.js');
      assert.strictEqual(parsed.timeout, 0);
    });

    it('requires a file argument', () => {
      assert.throws(() => parseCommand(commands['run'], { _: ['run'] }));
    });

    it('rejects too many positional args', () => {
      assert.throws(() => parseCommand(commands['run'], { _: ['run', 'a.js', 'b.js'] }), /too many/i);
    });
  });
});
