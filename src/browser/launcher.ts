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

  async close(): Promise<void> {
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    this.context = null;
    this.browser = null;
    this.page = null;
  }
}
