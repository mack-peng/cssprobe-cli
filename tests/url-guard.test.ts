import { describe, it } from 'node:test';
import assert from 'node:assert';
import { looksLikeLoginUrl, matchesUrlPattern } from '../src/cli/url-guard';

describe('url-guard', () => {
  it('detects login redirects on either path style', () => {
    assert.strictEqual(looksLikeLoginUrl('https://example.com/s/login'), true);
    assert.strictEqual(looksLikeLoginUrl('https://example.com/s/login?ref=edit'), true);
    assert.strictEqual(looksLikeLoginUrl('https://example.com/login'), true);
    assert.strictEqual(looksLikeLoginUrl('https://example.com/login/callback'), true);
  });

  it('does not flag normal pages', () => {
    assert.strictEqual(looksLikeLoginUrl('https://example.com/'), false);
    assert.strictEqual(looksLikeLoginUrl('https://example.com/login-help'), false);
    assert.strictEqual(looksLikeLoginUrl('not a url'), false);
  });

  it('matches expect-url patterns', () => {
    assert.strictEqual(matchesUrlPattern('/preview', 'https://example.com/preview?x=1'), true);
    assert.strictEqual(matchesUrlPattern('^https://example\\.com/$', 'https://example.com/'), true);
    assert.strictEqual(matchesUrlPattern('/edit$', 'https://example.com/preview'), false);
  });

  it('rejects invalid patterns', () => {
    assert.throws(() => matchesUrlPattern('(', 'https://example.com/'), /Invalid --expect-url/);
  });
});
