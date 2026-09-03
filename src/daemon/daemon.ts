/**
 * Daemon process for cssprobe-cli.
 * Manages browser and executes commands via Unix socket.
 * Adapted from playwright-cli.
 */

import fs from 'fs';
import net from 'net';
import path from 'path';

import { SocketConnection } from '../utils/socketConnection';
import { BrowserLauncher } from '../browser/launcher';
import { analyze } from '../engine/analyzer';
import { renderMarkdown, renderJSON } from '../engine/renderer';
import { renderNode } from '../engine/renderers/dom-tree';

import type { SessionConfig, ClientInfo } from './session';

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

export interface DaemonOptions {
  headed?: boolean;
  browser?: string;
  viewport?: { width: number; height: number };
  state?: string;
}

export async function startDaemon(
  sessionName: string,
  clientInfo: ClientInfo,
  options: DaemonOptions
): Promise<string> {
  const sessionConfig = createSessionConfig(clientInfo, sessionName, options);
  const { socketPath } = sessionConfig;

  // Clean up existing socket file on Unix
  if (process.platform !== 'win32' && await socketExists(socketPath)) {
    try {
      await fs.promises.unlink(socketPath);
    } catch (error) {
      throw error;
    }
  }

  // Create browser launcher
  const launcher = new BrowserLauncher({
    browser: options.browser || 'chromium',
    headed: options.headed !== false,
    viewport: options.viewport,
    state: options.state,
  });

  const server = net.createServer(socket => {
    const connection = new SocketConnection(socket);
    connection.onmessage = async message => {
      const { id, method, params } = message;
      try {
        if (method === 'stop') {
          await deleteSessionFile(sessionConfig);
          await launcher.close();
          connection.send({ id, result: 'ok' }).catch(() => {});
          process.exit(0);
        } else if (method === 'run') {
          const result = await executeCommand(launcher, params.args);
          await connection.send({ id, result });
        } else {
          throw new Error(`Unknown method: ${method}`);
        }
      } catch (e) {
        const error = (e as Error).message;
        connection.send({ id, error }).catch(() => {});
      }
    };
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(socketPath, () => resolve());
  });

  await saveSessionFile(clientInfo, sessionConfig);
  console.log(`Daemon listening on ${socketPath}`);
  return socketPath;
}

async function executeCommand(
  launcher: BrowserLauncher,
  args: Record<string, any> & { _: string[] }
): Promise<{ text: string }> {
  const command = args._[0];
  const params = args._.slice(1);

  switch (command) {
    case 'goto': {
      const url = params[0] || 'about:blank';
      await launcher.open(url);
      return { text: `Navigated to ${url}` };
    }

    case 'inspect': {
      const selector = params[0];
      if (!selector)
        throw new Error('Selector is required for inspect command');

      const snapshot = await launcher.collect({
        rootSelector: selector,
        downDepth: args.depth || 6,
        maxNodes: 60,
        upTo: 'html',
      });

      const findings = analyze(snapshot);

      if (args.json) {
        return { text: JSON.stringify(renderJSON(snapshot, findings, args.brief), null, 2) };
      } else {
        return { text: renderMarkdown(snapshot, findings, args.brief, args.layout) };
      }
    }

    case 'tree': {
      const selector = params[0];
      if (!selector)
        throw new Error('Selector is required for tree command');

      const snapshot = await launcher.collect({
        rootSelector: selector,
        downDepth: args.depth || 6,
        maxNodes: 60,
        upTo: 'html',
      });

      // Render tree only
      const lines: string[] = [];
      lines.push(`## DOM tree (${snapshot.downDepth} levels deep)`);
      lines.push('```');
      lines.push(...renderNode(snapshot.tree!, 0));
      lines.push('```');
      return { text: lines.join('\n') };
    }

    case 'layout': {
      const selector = params[0];
      if (!selector)
        throw new Error('Selector is required for layout command');

      const snapshot = await launcher.collect({
        rootSelector: selector,
        downDepth: 6,
        maxNodes: 60,
        upTo: 'html',
      });

      const findings = analyze(snapshot);
      return { text: renderMarkdown(snapshot, findings, false, true) };
    }

    case 'findings': {
      const selector = params[0];
      if (!selector)
        throw new Error('Selector is required for findings command');

      const snapshot = await launcher.collect({
        rootSelector: selector,
        downDepth: 6,
        maxNodes: 60,
        upTo: 'html',
      });

      const findings = analyze(snapshot);
      const important = findings.filter(f => f.level === 'warning' || f.level === 'error');
      
      if (important.length === 0) {
        return { text: 'No warnings or errors found.' };
      }

      const lines = important.map(f => {
        return `- ⚠ ${f.message} [${f.confidence}]${f.location ? ` @ ${f.location}` : ''}`;
      });
      return { text: lines.join('\n') };
    }

    case 'inject-css': {
      const css = params[0];
      if (!css)
        throw new Error('CSS is required for inject-css command');

      const page = launcher.getPage();
      if (!page)
        throw new Error('Browser is not open. Run: cssprobe-cli open <url>');

      await page.addStyleTag({ content: css });
      return { text: JSON.stringify({ success: true }) };
    }

    case 'screenshot': {
      const page = launcher.getPage();
      if (!page)
        throw new Error('Browser is not open. Run: cssprobe-cli open <url>');

      const buffer = await page.screenshot({ fullPage: args['full-page'] });
      const base64 = buffer.toString('base64');
      return { text: `data:image/png;base64,${base64}` };
    }

    case 'eval': {
      const expression = params[0];
      if (!expression)
        throw new Error('Expression is required for eval command');

      const page = launcher.getPage();
      if (!page)
        throw new Error('Browser is not open. Run: cssprobe-cli open <url>');

      const result = await page.evaluate(expression);
      return { text: JSON.stringify(result, null, 2) };
    }

    case 'resize': {
      const width = parseInt(params[0], 10);
      const height = parseInt(params[1], 10);
      if (isNaN(width) || isNaN(height))
        throw new Error('Usage: cssprobe-cli resize <width> <height>');

      const page = launcher.getPage();
      if (!page)
        throw new Error('Browser is not open. Run: cssprobe-cli open <url>');

      await page.setViewportSize({ width, height });
      return { text: JSON.stringify({ width, height }) };
    }

    case 'playwright': {
      const call = params[0];
      if (!call)
        throw new Error('Playwright API call is required');

      const page = launcher.getPage();
      if (!page)
        throw new Error('Browser is not open. Run: cssprobe-cli open <url>');

      // Create a safe eval context with page and browser objects
      const asyncFunction = new AsyncFunction('page', 'browser', `return ${call}`);
      const browser = page.context().browser();
      const result = await asyncFunction(page, browser);
      return { text: JSON.stringify(result, null, 2) };
    }

    case 'state-save': {
      const context = launcher.getContext();
      if (!context)
        throw new Error('Browser is not open. Run: cssprobe-cli open <url>');
      const state = await context.storageState();
      return { text: JSON.stringify(state) };
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function socketExists(socketPath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(socketPath);
    return stat?.isSocket() || false;
  } catch {
    return false;
  }
}

function createSessionConfig(clientInfo: ClientInfo, sessionName: string, options: DaemonOptions): SessionConfig {
  return {
    name: sessionName,
    version: clientInfo.version,
    timestamp: Date.now(),
    socketPath: daemonSocketPath(clientInfo, sessionName),
    browser: {
      browserName: options.browser || 'chromium',
      launchOptions: { headless: options.headed === false },
    },
  };
}

function daemonSocketPath(clientInfo: ClientInfo, sessionName: string): string {
  return path.join(clientInfo.daemonProfilesDir, `${sessionName}.sock`);
}

async function saveSessionFile(clientInfo: ClientInfo, sessionConfig: SessionConfig): Promise<void> {
  await fs.promises.mkdir(clientInfo.daemonProfilesDir, { recursive: true });
  const sessionFile = path.join(clientInfo.daemonProfilesDir, `${sessionConfig.name}.session`);
  await fs.promises.writeFile(sessionFile, JSON.stringify(sessionConfig, null, 2));
}

async function deleteSessionFile(sessionConfig: SessionConfig): Promise<void> {
  await fs.promises.unlink(sessionConfig.socketPath).catch(() => {});
  const sessionFile = path.join(path.dirname(sessionConfig.socketPath), `${sessionConfig.name}.session`);
  await fs.promises.rm(sessionFile).catch(() => {});
}
