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

import type { SessionConfig, ClientInfo } from './session';

export interface DaemonOptions {
  headed?: boolean;
  browser?: string;
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
      renderNode(snapshot.tree, lines, 0);
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
        const icon = f.level === 'error' ? '⚠' : '⚠';
        return `- ${icon} ${f.message} [${f.confidence}]${f.location ? ` @ ${f.location}` : ''}`;
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

      const buffer = await page.screenshot({ fullPage: args.fullPage });
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

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function renderNode(node: any, lines: string[], indent: number): void {
  if (!node) return;
  const cls = node.classes?.length ? `.${node.classes.join('.')}` : '';
  const id = node.id ? `#${node.id}` : '';
  const m = node.metrics;
  const s = node.shape || {};
  const shapeStr = s.role ? `[${s.role} h:${s.heightStrategy} w:${s.widthStrategy}]` : '';
  const flag: string[] = [];
  if (node.flags?.overflowsParent) flag.push('⚠parent-overflow');
  if (node.flags?.overflowsViewport) flag.push('⚠viewport-overflow');
  if (m?.clientHeight === 0 && m?.offsetHeight === 0) flag.push('⚠collapsed');
  lines.push(`${'  '.repeat(indent)}<${node.tag}${id}${cls}> ${shapeStr} [${node.props?.position},${node.props?.display}] rect(${m?.rect?.width}×${m?.rect?.height})${flag.length ? ' ' + flag.join(' ') : ''}`);
  for (const child of node.children || []) renderNode(child, lines, indent + 1);
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
