import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Session, loadSession, listAllSessions } from '../daemon/session';
import type { SessionConfig } from '../daemon/session';
import type { AnyCommandSchema } from './command';

export interface OpenOptions {
  url?: string;
  browser?: string;
  headed?: boolean;
  viewport?: { width: number; height: number };
  state?: string;
}

export interface OpenResult {
  sessionId: string;
  pid?: number;
  url: string;
  viewport: { width: number; height: number };
}

export async function openSession(opts: OpenOptions): Promise<OpenResult> {
  const url = opts.url || 'about:blank';
  const browser = opts.browser || 'chromium';

  const { pid } = await Session.startDaemon({
    browser,
    headed: !!opts.headed,
    viewport: opts.viewport,
    state: opts.state,
    _: ['open', url],
  }, 'open');

  const session = await waitForSession(5000);
  if (!session)
    throw new Error('Daemon failed to become ready within 5s. Check the daemon log for errors.');
  await session.run({ _: ['goto', url] });

  return {
    sessionId: 'default',
    pid,
    url,
    viewport: opts.viewport || { width: 1280, height: 720 },
  };
}

export async function waitForSession(timeoutMs: number): Promise<Session | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = await loadSession();
    if (session && await session.canConnect()) return session;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return undefined;
}

export interface CloseResult {
  sessions: Array<{ sessionId: string; closed: boolean; error?: string }>;
}

export async function closeSession(all = false): Promise<CloseResult> {
  if (all) {
    const sessions = await listAllSessions();
    if (sessions.length === 0)
      throw new Error('No active sessions found.');

    const results: CloseResult['sessions'] = [];
    for (const session of sessions) {
      try {
        await session.stop();
        results.push({ sessionId: session.name, closed: true });
      } catch (e) {
        results.push({ sessionId: session.name, closed: false, error: (e as Error).message });
      }
    }
    return { sessions: results };
  }

  const session = await loadSession();
  if (!session)
    throw new Error('No active session. Run: cssprobe-cli open <url>');

  await session.stop();
  return { sessions: [{ sessionId: 'default', closed: true }] };
}

export interface StatusResult {
  sessionId: string;
  alive: boolean;
  config?: SessionConfig;
}

export async function getSessionStatus(): Promise<StatusResult> {
  const session = await loadSession();
  if (!session) return { sessionId: 'default', alive: false };

  const canConnect = await session.canConnect();
  return {
    sessionId: 'default',
    alive: canConnect,
    config: session.config,
  };
}

export function buildDaemonArgs(
  commandName: string,
  command: AnyCommandSchema,
  parsed: Record<string, unknown>
): string[] {
  const daemonArgs: string[] = [commandName];

  if (command.args) {
    for (const name of Object.keys(command.args.shape)) {
      if (parsed[name] !== undefined) daemonArgs.push(String(parsed[name]));
    }
  }

  if (command.options) {
    for (const name of Object.keys(command.options.shape)) {
      if (parsed[name] === undefined) continue;
      if (typeof parsed[name] === 'boolean') {
        if (parsed[name]) daemonArgs.push(`--${name}`);
      } else {
        daemonArgs.push(`--${name}=${parsed[name]}`);
      }
    }
  }

  return daemonArgs;
}

export async function runSessionCommand(
  commandName: string,
  command: AnyCommandSchema,
  parsed: Record<string, unknown>,
  json = false
): Promise<{ text: string }> {
  const session = await loadSession();
  if (!session)
    throw new Error('No active session. Run: cssprobe-cli open <url>');

  const daemonArgs = buildDaemonArgs(commandName, command, parsed);
  const runArgs: Record<string, unknown> & { _: string[] } = { ...parsed, _: daemonArgs };
  if (json) runArgs.json = true;

  return await session.run(runArgs);
}

export function saveScreenshotFile(dataUrl: string, out?: string): string {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  const resolvedOut = out
    ? path.resolve(out)
    : (() => {
        const dir = path.join(os.homedir(), '.cssprobe-cli', 'screenshots');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        return path.join(dir, `screenshot-${ts}.png`);
      })();
  const dir = path.dirname(resolvedOut);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolvedOut, buffer);
  return resolvedOut;
}
