import { Session, loadSession, listAllSessions } from '../daemon/session';
import type { SessionConfig } from '../daemon/session';
import { findDaemonProcesses, killProcessTree } from '../daemon/processSweep';
import type { DaemonProcess } from '../daemon/processSweep';
import type { AnyCommandSchema } from './command';
import { looksLikeLoginUrl, matchesUrlPattern } from './url-guard';

export { saveScreenshotFile } from '../utils/screenshot';

export interface OpenOptions {
  url?: string;
  browser?: string;
  headed?: boolean;
  viewport?: { width: number; height: number };
  state?: string;
  expectUrl?: string;
  failOnLogin?: boolean;
}

export interface OpenResult {
  sessionId: string;
  pid?: number;
  url: string;
  viewport: { width: number; height: number };
}

export interface PageInfo {
  url: string;
  title: string;
  frames: number;
}

export async function getPageInfo(): Promise<PageInfo> {
  const session = await loadSession();
  if (!session) throw new Error('No active session. Run: cssprobe-cli open <url>');
  const result = await session.run({ _: ['page-info'] });
  return JSON.parse(result.text) as PageInfo;
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

  const info = await getPageInfo();
  const guardError = (() => {
    if (opts.failOnLogin && looksLikeLoginUrl(info.url)) {
      return `Login required: page redirected to ${info.url}. Refresh the state file or log in manually.`;
    }
    if (opts.expectUrl && !matchesUrlPattern(opts.expectUrl, info.url)) {
      return `Expected URL to match ${opts.expectUrl}, got ${info.url}`;
    }
    return null;
  })();
  if (guardError) {
    await closeSession();
    throw new Error(guardError);
  }

  return {
    sessionId: 'default',
    pid,
    url: info.url,
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

export type CloseMethod = 'socket' | 'process' | 'cleaned';

export interface CloseResult {
  sessions: Array<{ sessionId: string; closed: boolean; method?: CloseMethod; error?: string }>;
}

export interface SweepOps {
  find: () => Promise<DaemonProcess[]>;
  kill: (pid: number) => Promise<void>;
}

const defaultSweep: SweepOps = { find: findDaemonProcesses, kill: killProcessTree };

export async function closeAllSessions(sessions: Session[], sweep: SweepOps = defaultSweep): Promise<CloseResult> {
  const results: CloseResult['sessions'] = [];

  for (const session of sessions) {
    try {
      const { wasOpen } = await session.stop();
      if (wasOpen) {
        results.push({ sessionId: session.name, closed: true, method: 'socket' });
      } else {
        await session.removeStaleFiles();
        results.push({ sessionId: session.name, closed: false, method: 'cleaned', error: 'session not reachable' });
      }
    } catch (e) {
      results.push({ sessionId: session.name, closed: false, error: (e as Error).message });
    }
  }

  for (const orphan of await sweep.find()) {
    try {
      await sweep.kill(orphan.pid);
      results.push({ sessionId: `pid-${orphan.pid}`, closed: true, method: 'process' });
    } catch (e) {
      results.push({ sessionId: `pid-${orphan.pid}`, closed: false, method: 'process', error: (e as Error).message });
    }
  }

  if (results.length === 0)
    throw new Error('No active sessions found.');
  return { sessions: results };
}

export async function closeReachableSession(session: Session): Promise<CloseResult> {
  const { wasOpen } = await session.stop();
  if (!wasOpen) {
    await session.removeStaleFiles();
    return { sessions: [{ sessionId: session.name, closed: false, method: 'cleaned', error: 'session not reachable' }] };
  }
  return { sessions: [{ sessionId: session.name, closed: true, method: 'socket' }] };
}

export async function closeSession(all = false): Promise<CloseResult> {
  if (all) {
    const sessions = await listAllSessions();
    return await closeAllSessions(sessions);
  }

  const session = await loadSession();
  if (!session)
    throw new Error('No active session. Run: cssprobe-cli open <url>');

  return await closeReachableSession(session);
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
): Promise<{ text: string; exitCode?: number }> {
  const session = await loadSession();
  if (!session)
    throw new Error('No active session. Run: cssprobe-cli open <url>');

  const daemonArgs = buildDaemonArgs(commandName, command, parsed);
  const runArgs: Record<string, unknown> & { _: string[] } = { ...parsed, _: daemonArgs };
  if (json) runArgs.json = true;

  return await session.run(runArgs);
}
