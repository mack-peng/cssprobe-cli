// Playwright launcher — opens a browser, navigates, injects the collector bundle,
// and returns a Snapshot. The collector bundle is read from dist/collector-bundle.js.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from 'playwright-core';
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

/** Try to find an existing browser executable in the Playwright cache. */
function findBrowserExecutable(engine: string): string | null {
  const cacheDir = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!fs.existsSync(cacheDir)) return null;

  const platform = process.platform;
  if (engine === 'chromium') {
    // Look for chromium-* directories (sorted newest first)
    const dirs = fs.readdirSync(cacheDir)
      .filter(d => d.startsWith('chromium-'))
      .sort((a, b) => {
        const na = parseInt(a.split('-')[1]) || 0;
        const nb = parseInt(b.split('-')[1]) || 0;
        return nb - na;
      });
    for (const dir of dirs) {
      if (platform === 'darwin') {
        const app = path.join(cacheDir, dir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
        if (fs.existsSync(app)) return app;
        const appIntel = path.join(cacheDir, dir, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
        if (fs.existsSync(appIntel)) return appIntel;
      } else if (platform === 'linux') {
        const bin = path.join(cacheDir, dir, 'chrome-linux', 'chrome');
        if (fs.existsSync(bin)) return bin;
      }
    }
  }
  return null;
}

export class BrowserLauncher {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(private options: LauncherOptions = {}) {}

  async open(url: string): Promise<void> {
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

    this.browser = await factory.launch(launchOptions);

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

  async collect(cfg: CollectConfig): Promise<Snapshot> {
    if (!this.page) throw new Error('Browser not opened. Call open() first.');
    const bundle = loadBundle();
    await this.page.addScriptTag({ content: bundle });
    const snapshot = await this.page.evaluate((config) => {
      return (window as any).__cssprobe_cli.collect(config);
    }, cfg);
    return snapshot as Snapshot;
  }

  /** Measure the DOM tree depth from a root selector to the deepest leaf. */
  async measureDepth(selector: string): Promise<number> {
    if (!this.page) throw new Error('Browser not opened. Call open() first.');
    return this.page.evaluate((sel) => {
      const root = document.querySelector(sel);
      if (!root) return 0;
      let maxDepth = 0;
      const walk = (el: Element, depth: number) => {
        if (depth > maxDepth) maxDepth = depth;
        for (const child of Array.from(el.children)) walk(child, depth + 1);
      };
      walk(root, 0);
      return maxDepth;
    }, selector);
  }

  /** Wait for user to interact with the page. Press Enter to continue. */
  async waitForUser(): Promise<void> {
    console.error('');
    console.error('  Browser is open. Perform your actions (login, click buttons, open dialogs, etc.).');
    console.error('  Press Enter here when ready to inspect...');
    console.error('');
    await new Promise<void>(resolve => {
      process.stdin.once('data', () => resolve());
    });
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

  /** Scan the page for likely root elements (modals, dialogs, scroll containers). */
  async autoDetectRoot(): Promise<string[]> {
    if (!this.page) throw new Error('Browser not opened. Call open() first.');
    return this.page.evaluate(() => {
      const candidates: Array<{ selector: string; score: number }> = [];
      const seen = new Set<string>();

      function addSelector(sel: string, score: number) {
        if (seen.has(sel)) return;
        seen.add(sel);
        candidates.push({ selector: sel, score });
      }

      // Modals / dialogs
      for (const el of Array.from(document.querySelectorAll('.s-kit-modal, [class*="dialog"], [class*="modal"], [class*="popup"]'))) {
        const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).join('.');
        if (cls) addSelector(`.${cls.split(/\s+/)[0]}`, 10);
      }

      // Scroll containers (overflow-y: auto/scroll with content overflow)
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const cs = getComputedStyle(el);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
            (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 1 &&
            (el as HTMLElement).clientHeight > 100) {
          const tag = el.tagName.toLowerCase();
          const id = el.id ? `#${el.id}` : '';
          const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
          const sel = id || (cls ? `${tag}.${cls}` : tag);
          addSelector(sel, 5);
        }
      }

      // Sections with substantial content
      for (const el of Array.from(document.querySelectorAll('section, [class*="section"], main, [role="main"]'))) {
        const tag = el.tagName.toLowerCase();
        const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        const sel = cls ? `${tag}.${cls}` : tag;
        addSelector(sel, 3);
      }

      return candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(c => c.selector);
    });
  }

  /**
   * Interactive login flow: opens browser in headed mode, navigates to URL,
   * waits for user to complete login, then saves storage state.
   * Returns the path to the saved state file.
   */
  async loginAndSave(url: string, statePath: string): Promise<string> {
    const engine = this.options.browser || 'chromium';
    const factory =
      engine === 'firefox' ? firefox :
      engine === 'webkit' ? webkit :
      chromium;

    const execPath = findBrowserExecutable(engine);
    const launchOptions: Record<string, any> = { headless: false };
    if (execPath) launchOptions.executablePath = execPath;

    this.browser = await factory.launch(launchOptions);
    const vp = this.options.viewport || { width: 1280, height: 720 };
    this.context = await this.browser.newContext({ viewport: vp });
    this.page = await this.context.newPage();

    // Navigate to the target URL
    if (url.startsWith('http://') || url.startsWith('https://')) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } else {
      throw new Error('--login only works with http/https URLs');
    }

    // Wait for user to complete login (detect URL change or navigation)
    console.error('');
    console.error('  Browser opened. Please complete the login manually.');
    console.error('  The browser will detect when you navigate away from the login page,');
    console.error('  or you can press Enter here when done.');
    console.error('');

    // Wait for either URL change or Enter keypress
    await Promise.race([
      this.page.waitForURL('**/*', { timeout: 300000 }).catch(() => {}),
      new Promise<void>(resolve => {
        process.stdin.once('data', () => resolve());
      }),
    ]);

    // Small delay to let cookies/localStorage settle
    await this.page.waitForTimeout(1000);

    // Save state
    const resolvedPath = path.resolve(statePath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await this.context.storageState({ path: resolvedPath });
    console.error(`  State saved to: ${resolvedPath}`);

    return resolvedPath;
  }

  /** Get the current page object. */
  getPage(): Page | null {
    return this.page;
  }

  async close(): Promise<void> {
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    this.context = null;
    this.browser = null;
    this.page = null;
  }
}
