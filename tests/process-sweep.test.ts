import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  parseProcessRows,
  matchDaemonProcesses,
  collectProcessTree,
  findDaemonProcesses,
  killProcessTree,
} from '../src/daemon/processSweep';
import { Session } from '../src/daemon/session';
import type { SessionConfig } from '../src/daemon/session';
import { closeAllSessions, closeReachableSession } from '../src/cli/session-ops';
import type { SweepOps } from '../src/cli/session-ops';

const SAMPLE_PS = `
    1     1 /sbin/launchd
  19336     1 node /Users/mack/.nvm/versions/node/v24.1.0/lib/node_modules/cssprobe-cli/dist/daemon/daemonEntry.js default --headed --browser=chromium
  19778     1 node /Users/mack/.nvm/versions/node/v24.1.0/lib/node_modules/cssprobe-cli/dist/daemon/daemonEntry.js default --headed
  20283     1 node /Users/mack/.nvm/versions/node/v24.1.0/lib/node_modules/cssprobe-cli/dist/daemon/daemonEntry.js default --headed --state=/Users/mack/.cssprobe-cli/states/strikingly-www.json
  43210     1 node /Users/mack/.nvm/versions/node/v24.1.0/lib/node_modules/playwright-cli/dist/daemon/daemonEntry.js default
  43211 19336 /Users/mack/Library/Caches/ms-playwright/chromium-1200/chrome-mac/Chromium
`;

describe('processSweep', () => {
  describe('parseProcessRows', () => {
    it('parses pid, ppid and command from ps output', () => {
      const rows = parseProcessRows(SAMPLE_PS);
      assert.strictEqual(rows.length, 6);
      assert.deepStrictEqual(rows[1], {
        pid: 19336,
        ppid: 1,
        command: 'node /Users/mack/.nvm/versions/node/v24.1.0/lib/node_modules/cssprobe-cli/dist/daemon/daemonEntry.js default --headed --browser=chromium',
      });
    });

    it('skips malformed lines', () => {
      const rows = parseProcessRows('garbage line\n  100   1 ok command\n');
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].pid, 100);
    });
  });

  describe('matchDaemonProcesses', () => {
    const rows = parseProcessRows(SAMPLE_PS);

    it('matches cssprobe daemons across install locations', () => {
      const matched = matchDaemonProcesses(rows, 0);
      assert.deepStrictEqual(matched.map(m => m.pid).sort((a, b) => a - b), [19336, 19778, 20283]);
    });

    it('excludes processes of other tools (playwright-cli)', () => {
      const matched = matchDaemonProcesses(rows, 0);
      assert.ok(!matched.some(m => m.pid === 43210));
    });

    it('requires daemonEntry.js as a path segment, not a bare word', () => {
      const grepLike = [{ pid: 55555, ppid: 1, command: 'rg daemonEntry.js /Users/mack/Cli-projects/cssprobe-cli' }];
      assert.strictEqual(matchDaemonProcesses(grepLike, 0).length, 0);
    });

    it('excludes the caller itself', () => {
      const rows2 = [...rows, { pid: 99999, ppid: 1, command: `node /opt/cssprobe-cli/dist/daemon/daemonEntry.js default` }];
      const matched = matchDaemonProcesses(rows2, 99999);
      assert.ok(!matched.some(m => m.pid === 99999));
    });
  });

  describe('collectProcessTree', () => {
    it('collects root and all descendants', () => {
      const rows = parseProcessRows(SAMPLE_PS);
      const tree = collectProcessTree(rows, 19336);
      assert.deepStrictEqual(tree, [19336, 43211]);
    });

    it('returns just the root when it has no children in rows', () => {
      const rows = parseProcessRows(SAMPLE_PS);
      assert.deepStrictEqual(collectProcessTree(rows, 43210), [43210]);
    });
  });

  describe('findDaemonProcesses', () => {
    it('uses injected rows provider and excludes self pid', async () => {
      const rows = parseProcessRows(SAMPLE_PS).concat([{ pid: process.pid, ppid: 1, command: `node /opt/cssprobe-cli/dist/daemon/daemonEntry.js default` }]);
      const found = await findDaemonProcesses(async () => rows);
      assert.deepStrictEqual(found.map(f => f.pid).sort((a, b) => a - b), [19336, 19778, 20283]);
    });
  });

  describe('killProcessTree', () => {
    it('signals the whole tree and survives missing pids', async () => {
      const rows = parseProcessRows(SAMPLE_PS);
      const sent: Array<{ pid: number; sig: string }> = [];
      const originalKill = process.kill.bind(process);
      const killMock = mock.method(process, 'kill', (pid: number, sig?: string | number) => {
        sent.push({ pid, sig: String(sig) });
        if (sig === 0 && pid !== 19336) throw new Error('ESRCH');
        return true;
      });
      try {
        await killProcessTree(19336, async () => rows, 100);
      } finally {
        killMock.mock.restore();
        void originalKill;
      }
      const term = sent.filter(s => s.sig === 'SIGTERM').map(s => s.pid);
      assert.deepStrictEqual(term.sort((a, b) => a - b), [19336, 43211]);
    });
  });
});

describe('closeSession rework', () => {
  function makeSession(name: string, wasOpen: boolean, files?: { session: string; socket: string }): Session {
    const staleFiles = files;
    return {
      name,
      stop: async () => ({ wasOpen }),
      removeStaleFiles: async () => {
        if (!staleFiles) return;
        fs.rmSync(staleFiles.session, { force: true });
        fs.rmSync(staleFiles.socket, { force: true });
      },
    } as unknown as Session;
  }

  it('reports socket-closed, killed orphans and summary', async () => {
    const sweep: SweepOps = {
      find: async () => [{ pid: 4242, command: 'node daemonEntry.js' }],
      kill: async () => {},
    };
    const result = await closeAllSessions([makeSession('default', true)], sweep);
    assert.deepStrictEqual(result.sessions, [
      { sessionId: 'default', closed: true, method: 'socket' },
      { sessionId: 'pid-4242', closed: true, method: 'process' },
    ]);
  });

  it('cleans stale session and reports not reachable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cssprobe-close-'));
    const sessionFile = path.join(dir, 'default.session');
    const socketFile = path.join(dir, 'default.sock');
    fs.writeFileSync(sessionFile, '{}');
    fs.writeFileSync(socketFile, '');

    const session = makeSession('default', false, { session: sessionFile, socket: socketFile });
    const result = await closeAllSessions([session], { find: async () => [], kill: async () => {} });

    assert.deepStrictEqual(result.sessions, [
      { sessionId: 'default', closed: false, method: 'cleaned', error: 'session not reachable' },
    ]);
    assert.ok(!fs.existsSync(sessionFile));
    assert.ok(!fs.existsSync(socketFile));
  });

  it('throws when nothing found at all', async () => {
    await assert.rejects(
      () => closeAllSessions([], { find: async () => [], kill: async () => {} }),
      /No active sessions found\./
    );
  });

  it('continues after a session stop throws', async () => {
    const failing = {
      name: 'broken',
      stop: async () => { throw new Error('boom'); },
      removeStaleFiles: async () => {},
    } as unknown as Session;
    const result = await closeAllSessions([failing, makeSession('default', true)], { find: async () => [], kill: async () => {} });
    assert.deepStrictEqual(result.sessions[0], { sessionId: 'broken', closed: false, error: 'boom' });
    assert.deepStrictEqual(result.sessions[1], { sessionId: 'default', closed: true, method: 'socket' });
  });

  it('closeReachableSession cleans stale files when not reachable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cssprobe-close-'));
    const sessionFile = path.join(dir, 'default.session');
    const socketFile = path.join(dir, 'default.sock');
    fs.writeFileSync(sessionFile, '{}');
    fs.writeFileSync(socketFile, '');

    const config: SessionConfig = {
      name: 'default',
      version: '0.0.0',
      timestamp: 0,
      socketPath: socketFile,
      browser: { browserName: 'chromium', launchOptions: {} },
    };
    const session = new Session({ file: sessionFile, config, daemonDir: dir });
    mock.method(session, 'stop', async () => ({ wasOpen: false }));

    const result = await closeReachableSession(session);
    assert.deepStrictEqual(result.sessions, [
      { sessionId: 'default', closed: false, method: 'cleaned', error: 'session not reachable' },
    ]);
    assert.ok(!fs.existsSync(sessionFile));
    assert.ok(!fs.existsSync(socketFile));
  });
});
