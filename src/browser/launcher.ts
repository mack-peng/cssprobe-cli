// Playwright launcher — opens a browser, navigates, injects the collector bundle,
// and returns a Snapshot. The collector bundle is read from dist/collector-bundle.js.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { chromium, firefox, webkit, type Browser, type BrowserContext, type Frame, type Page } from 'playwright-core';
import type { Snapshot, CollectConfig } from '../engine/types';

export interface LauncherOptions {
  browser?: string;
  headed?: boolean;
  /** Path to a Playwright storage state file (cookies + localStorage). */
  state?: string;
  /** Custom viewport size. Defaults to 1280×720. */
  viewport?: { width: number; height: number };
}

const COLLECTOR_BUNDLE_PATH = path.join(__dirname, '..', 'collector-bundle.js');

let bundleContent: string | null = null;
function loadBundle(): string {
  if (bundleContent !== null) return bundleContent;
  if (!fs.existsSync(COLLECTOR_BUNDLE_PATH)) {
    throw new Error(
      `collector bundle not found at ${COLLECTOR_BUNDLE_PATH}. Run "npm run build" first.`
    );
  }
  bundleContent = fs.readFileSync(COLLECTOR_BUNDLE_PATH, 'utf-8');
  return bundleContent;
}

export type BrowserKind = 'chromium' | 'chromium-headless-shell';

export interface BrowserInstall {
  kind: BrowserKind;
  revision: number;
  dir: string;
  executable: string | null;
}

export interface BrowserExpectation {
  chromium?: number;
  headlessShell?: number;
  playwrightVersion?: string;
}

export type BrowserDiagnosisStatus = 'exact' | 'fallback' | 'missing';

export interface BrowserDiagnosis {
  platform: string;
  cacheRoots: string[];
  expected: BrowserExpectation;
  installs: BrowserInstall[];
  status: BrowserDiagnosisStatus;
  hint: string | null;
}

export function browserCacheRoots(): string[] {
  const fromEnv = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (fromEnv) return [fromEnv];

  if (process.platform === 'darwin') {
    return [path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')];
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return [path.join(localAppData, 'ms-playwright')];
  }
  return [path.join(os.homedir(), '.cache', 'ms-playwright')];
}

export function resolveExecutableIn(dir: string, platform: string): string | null {
  const candidates: string[] = [];
  if (platform === 'darwin') {
    candidates.push(
      path.join(dir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
    );
    candidates.push(
      path.join(dir, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
    );
  } else if (platform === 'linux') {
    candidates.push(path.join(dir, 'chrome-linux', 'chrome'));
    candidates.push(path.join(dir, 'chrome-linux64', 'chrome'));
  } else if (platform === 'win32') {
    candidates.push(path.join(dir, 'chrome-win', 'chrome.exe'));
    candidates.push(path.join(dir, 'chrome-win64', 'chrome.exe'));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function listBrowserInstalls(cacheRoots: string[] = browserCacheRoots()): BrowserInstall[] {
  const installs: BrowserInstall[] = [];
  for (const root of cacheRoots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      const match = /^(chromium|chromium_headless_shell)-(\d+)$/.exec(entry);
      if (!match) continue;
      const dir = path.join(root, entry);
      installs.push({
        kind: match[1] === 'chromium' ? 'chromium' : 'chromium-headless-shell',
        revision: parseInt(match[2], 10),
        dir,
        executable: resolveExecutableIn(dir, process.platform),
      });
    }
  }
  return installs.sort((a, b) => b.revision - a.revision);
}

export function expectedBrowsers(): BrowserExpectation {
  try {
    const pkgPath = require.resolve('playwright-core/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
    const browsersPath = path.join(path.dirname(pkgPath), 'browsers.json');
    const browsers = JSON.parse(fs.readFileSync(browsersPath, 'utf-8')) as {
      browsers?: Array<{ name: string; revision: string }>;
    };
    const chromium = browsers.browsers?.find(browser => browser.name === 'chromium');
    const headlessShell = browsers.browsers?.find(browser => browser.name === 'chromium-headless-shell');
    return {
      chromium: chromium ? parseInt(chromium.revision, 10) : undefined,
      headlessShell: headlessShell ? parseInt(headlessShell.revision, 10) : undefined,
      playwrightVersion: pkg.version,
    };
  } catch {
    return {};
  }
}

function installCommand(expected: BrowserExpectation): string {
  return expected.playwrightVersion
    ? `npx playwright@${expected.playwrightVersion} install chromium`
    : 'npx playwright install chromium';
}

export function diagnoseBrowser(
  engine: string = 'chromium',
  cacheRoots: string[] = browserCacheRoots()
): BrowserDiagnosis {
  const expected = expectedBrowsers();
  const installs = listBrowserInstalls(cacheRoots);
  const chromiumInstalls = installs.filter(install => install.kind === 'chromium' && install.executable);
  const exact = expected.chromium
    ? chromiumInstalls.some(install => install.revision === expected.chromium)
    : chromiumInstalls.length > 0;

  if (engine !== 'chromium') {
    return {
      platform: process.platform,
      cacheRoots,
      expected,
      installs,
      status: 'missing',
      hint: `Automatic discovery only covers chromium; run "npx playwright install ${engine}" if launch fails.`,
    };
  }

  if (exact) {
    return { platform: process.platform, cacheRoots, expected, installs, status: 'exact', hint: null };
  }

  if (chromiumInstalls.length > 0) {
    const found = chromiumInstalls.map(install => install.revision).join(', ');
    return {
      platform: process.platform,
      cacheRoots,
      expected,
      installs,
      status: 'fallback',
      hint: `Found chromium revision(s) ${found}, expected ${expected.chromium ?? 'unknown'}. Launch may work through the fallback. To install the expected build: ${installCommand(expected)}`,
    };
  }

  return {
    platform: process.platform,
    cacheRoots,
    expected,
    installs,
    status: 'missing',
    hint: `No chromium install found. Install it with: ${installCommand(expected)}`,
  };
}

/** Try to find an existing browser executable in the Playwright cache. */
export function findBrowserExecutable(
  engine: string,
  cacheRoots: string[] = browserCacheRoots()
): string | null {
  if (engine !== 'chromium') return null;

  const installs = listBrowserInstalls(cacheRoots).filter(
    install => install.kind === 'chromium' && install.executable
  );
  if (!installs.length) return null;

  const expected = expectedBrowsers().chromium;
  const exact = installs.find(install => install.revision === expected);
  return (exact ?? installs[0]).executable;
}

export class BrowserLauncher {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(private options: LauncherOptions = {}) {}

  async open(url: string): Promise<void> {
    await this.close();

    const engine = this.options.browser || 'chromium';
    const factory =
      engine === 'firefox' ? firefox :
      engine === 'webkit' ? webkit :
      chromium;

    const launchOptions: Record<string, any> = { headless: !this.options.headed };

    // Try to find existing browser installation
    const execPath = findBrowserExecutable(engine);
    if (execPath) {
      launchOptions.executablePath = execPath;
    }

    try {
      this.browser = await factory.launch(launchOptions);
    } catch (error) {
      const diagnosis = diagnoseBrowser(engine);
      throw new Error(
        `${(error as Error).message}\nBrowser diagnosis: ${diagnosis.status}. Run "cssprobe-cli doctor" for details.`
      );
    }

    // Load saved state if provided
    const vp = this.options.viewport || { width: 1280, height: 720 };
    const contextOptions: Record<string, any> = { viewport: vp };
    if (this.options.state && fs.existsSync(this.options.state)) {
      contextOptions.storageState = this.options.state;
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();

    if (url.startsWith('http://') || url.startsWith('https://')) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } else if (url.startsWith('file://')) {
      await this.page.goto(url, { waitUntil: 'load', timeout: 30000 });
    } else {
      // Treat as local path
      const resolved = path.resolve(url);
      if (!fs.existsSync(resolved)) {
        throw new Error(`File not found: ${resolved}`);
      }
      await this.page.goto(`file://${resolved}`, { waitUntil: 'load', timeout: 30000 });
    }
  }

  async collect(cfg: CollectConfig, target?: Page | Frame): Promise<Snapshot> {
    if (!this.page) throw new Error('Browser not opened. Call open() first.');
    const host = target ?? this.page;
    const bundle = loadBundle();
    await host.addScriptTag({ content: bundle });
    const snapshot = await host.evaluate((config) => {
      return (window as any).__cssprobe_cli.collect(config);
    }, cfg);
    return snapshot as Snapshot;
  }

  /** Navigate to a new URL in the existing page. */
  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error('Browser not opened. Call open() first.');
    if (url.startsWith('http://') || url.startsWith('https://')) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } else if (url.startsWith('file://')) {
      await this.page.goto(url, { waitUntil: 'load', timeout: 30000 });
    } else {
      const resolved = path.resolve(url);
      if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
      await this.page.goto(`file://${resolved}`, { waitUntil: 'load', timeout: 30000 });
    }
  }

  /** Get the current page object. */
  getPage(): Page | null {
    return this.page;
  }

  /** Get the current browser context. */
  getContext(): BrowserContext | null {
    return this.context;
  }

  async close(): Promise<void> {
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    this.context = null;
    this.browser = null;
    this.page = null;
  }
}
