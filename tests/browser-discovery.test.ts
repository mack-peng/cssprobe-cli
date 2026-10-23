import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveExecutableIn,
  listBrowserInstalls,
  findBrowserExecutable,
  diagnoseBrowser,
} from '../src/browser/launcher';

const tempDirs: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cssprobe-browsers-'));
  tempDirs.push(dir);
  return dir;
}

function makeExecutable(dir: string): string {
  const relative =
    process.platform === 'darwin'
      ? path.join('chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
      : process.platform === 'win32'
        ? path.join('chrome-win64', 'chrome.exe')
        : path.join('chrome-linux64', 'chrome');
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  return file;
}

function install(root: string, kind: 'chromium' | 'chromium_headless_shell', revision: number) {
  const dir = path.join(root, `${kind}-${revision}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('browser discovery', () => {
  it('resolves platform executable layouts', () => {
    const root = tempRoot();
    const expected = makeExecutable(root);
    assert.strictEqual(resolveExecutableIn(root, process.platform), expected);
    assert.strictEqual(resolveExecutableIn(path.join(root, 'missing'), process.platform), null);
  });

  it('lists chromium and headless-shell installs newest first', () => {
    const root = tempRoot();
    makeExecutable(install(root, 'chromium', 1200));
    makeExecutable(install(root, 'chromium', 1248));
    install(root, 'chromium_headless_shell', 1248);

    const installs = listBrowserInstalls([root]);
    assert.deepStrictEqual(
      installs.map(item => `${item.kind}-${item.revision}`),
      ['chromium-1248', 'chromium-headless-shell-1248', 'chromium-1200']
    );
    assert.ok(installs.find(item => item.kind === 'chromium' && item.revision === 1248)?.executable);
  });

  it('prefers the expected revision, then the newest fallback', () => {
    const root = tempRoot();
    makeExecutable(install(root, 'chromium', 1200));
    makeExecutable(install(root, 'chromium', 1248));
    assert.ok(findBrowserExecutable('chromium', [root])?.includes('1248'));

    const older = tempRoot();
    makeExecutable(install(older, 'chromium', 1100));
    makeExecutable(install(older, 'chromium', 1200));
    assert.ok(findBrowserExecutable('chromium', [older])?.includes('1200'));
  });

  it('returns null when no chromium executable exists', () => {
    const root = tempRoot();
    install(root, 'chromium', 1248);
    assert.strictEqual(findBrowserExecutable('chromium', [root]), null);
    assert.strictEqual(findBrowserExecutable('firefox', [root]), null);
  });

  it('reports missing, fallback and exact states', () => {
    const empty = tempRoot();
    const missing = diagnoseBrowser('chromium', [empty]);
    assert.strictEqual(missing.status, 'missing');
    assert.ok(missing.hint?.includes('install chromium'));

    const fallbackRoot = tempRoot();
    makeExecutable(install(fallbackRoot, 'chromium', 1200));
    const fallback = diagnoseBrowser('chromium', [fallbackRoot]);
    assert.ok(fallback.status === 'fallback' || fallback.status === 'exact');

    const exactRoot = tempRoot();
    makeExecutable(install(exactRoot, 'chromium', 1248));
    const exact = diagnoseBrowser('chromium', [exactRoot]);
    assert.ok(exact.status === 'exact' || exact.status === 'fallback');
  });
});
