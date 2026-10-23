import { describe, it } from 'node:test';
import assert from 'node:assert';
import { expect } from '../src/daemon/expect';

describe('expect', () => {
  it('passes matching values', () => {
    expect(9).toBe(9);
    expect(78).toBeWithin(78, 1, 'anchorTop');
    expect('#contact-us').toMatch(/contact/);
    expect('#home').toHaveHash('home');
    expect(8).toBeSelected(8);
  });

  it('fails with label and actual value', () => {
    assert.throws(() => expect(7).toBe(9, 'selected'), /expect \(selected\): expected 9, received 7/);
    assert.throws(() => expect(82).toBeWithin(78, 1, 'top'), /expect \(top\): expected 78 ±1, received 82/);
    assert.throws(() => expect('nope').toMatch('^#contact-us$'), /to match/);
    assert.throws(() => expect('').toHaveHash('#contact-us'), /expected hash #contact-us/);
    assert.throws(() => expect(0).toBeSelected(9), /expected selected index 9/);
  });

  it('rejects non-numeric values for toBeWithin and non-strings for toMatch', () => {
    assert.throws(() => expect('78' as any).toBeWithin(78, 1), /finite number/);
    assert.throws(() => expect(78 as any).toMatch(/78/), /expected a string/);
  });
});
