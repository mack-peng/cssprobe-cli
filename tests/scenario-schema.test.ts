import { describe, it } from 'node:test';
import assert from 'node:assert';
import { suiteSchema } from '../src/scenario/schema';

describe('scenario schema', () => {
  it('parses a valid suite', () => {
    const suite = suiteSchema.parse({
      name: 'ticket 26571394',
      defaults: { url: 'https://preprod.example.com/', viewport: { width: 1280, height: 800 } },
      cases: [
        {
          name: 'cold load',
          url: 'https://preprod.example.com/#contact-us',
          steps: [
            { do: 'sample', expression: 'location.hash', interval: 250, duration: 2000, save: 'hash' },
            { do: 'assert', on: 'hash', eq: '#contact-us' },
          ],
        },
      ],
    });
    assert.strictEqual(suite.cases.length, 1);
    assert.strictEqual(suite.cases[0].steps.length, 2);
  });

  it('rejects unknown steps', () => {
    assert.throws(
      () => suiteSchema.parse({ name: 'x', cases: [{ name: 'c', steps: [{ do: 'explode' }] }] }),
      /Invalid discriminator/
    );
  });

  it('rejects suites without cases', () => {
    assert.throws(() => suiteSchema.parse({ name: 'x', cases: [] }), /at least 1/);
  });

  it('accepts deployment fingerprint assertions', () => {
    const suite = suiteSchema.parse({
      name: 'fingerprint',
      cases: [
        {
          name: 'build check',
          steps: [
            { do: 'assert', globals: { setHashRestoreProtected: 'function' }, absent: ['navigateToSectionId'] },
          ],
        },
      ],
    });
    assert.ok(suite.cases[0].steps[0].do === 'assert');
  });
});
