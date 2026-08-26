/**
 * Session management for cssprobe-cli.
 * Simplified version of playwright-cli's session management.
 * Only supports single 'default' session.
 */

import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

import { SocketConnection } from '../utils/socketConnection';

export interface SessionConfig {
  name: string;
  version: string;
  timestamp: number;
  socketPath: string;
  browser: {
    browserName: string;
    launchOptions: Record<string, any>;
    userDataDir?: string;
  };
}

export interface SessionFile {
  file: string;
  daemonDir: string;
  config: SessionConfig;
}

export class Session {
  readonly name: string;
  readonly config: SessionConfig;
  private _sessionFile: SessionFile;

  constructor(sessionFile: SessionFile) {
    this.config = sessionFile.config;
    this.name = this.config.name;
    this._sessionFile = sessionFile;
  }

  async run(args: Record<string, any> & { _: string[] }): Promise<{ text: string }> {
    const { socket } = await this._connect();
    if (!socket)
      throw new Error('Browser is not open. Run:\n\n  cssprobe-cli open <url>\n\nto start the browser session.');
    return await SocketConnectionClient.sendAndClose(socket, 'run', { args, cwd: process.cwd() });
  }

  async stop(): Promise<{ wasOpen: boolean }> {
    if (!await this.canConnect())
      return { wasOpen: false };
    await this._stopDaemon();
    return { wasOpen: true };
  }

  async canConnect(): Promise<boolean> {
    const { socket } = await this._connect();
    if (socket) {
      socket.destroy();
      return true;
    }
    return false;
  }

  private async _connect(): Promise<{ socket?: net.Socket, error?: Error }> {
    return await new Promise(resolve => {
      const socket = net.createConnection(this.config.socketPath, () => {
        resolve({ socket });
      });
      socket.on('error', error => {
        if (os.platform() !== 'win32')
          void fs.promises.unlink(this.config.socketPath).catch(() => {}).then(() => resolve({ error }));
        else
          resolve({ error });
      });
    });
  }

  private async _stopDaemon(): Promise<void> {
    const { socket } = await this._connect();
    if (!socket)
      return;

    let error: Error | undefined;
    await SocketConnectionClient.sendAndClose(socket, 'stop', {}).catch(e => error = e);
    if (error && !error?.message?.includes('Session closed'))
      throw error;
  }

  static async startDaemon(args: Record<string, any>, mode: 'open' | 'attach'): Promise<{ pid: number | undefined }> {
    const clientInfo = createClientInfo();
    await fs.promises.mkdir(clientInfo.daemonProfilesDir, { recursive: true });

    const sessionName = 'default';
    const errLog = path.join(clientInfo.daemonProfilesDir, sessionName + '.err');
    const err = fs.openSync(errLog, 'w');

    const daemonArgs: string[] = [
      path.join(__dirname, 'daemonEntry.js'),
      sessionName,
    ];
    if (args.headed)
      daemonArgs.push('--headed');
    if (args.browser)
      daemonArgs.push(`--browser=${args.browser}`);
    if (args.state)
      daemonArgs.push(`--state=${args.state}`);

    const child = require('child_process').spawn(process.execPath, daemonArgs, {
      detached: true,
      stdio: ['ignore', 'pipe', err],
      cwd: process.cwd(),
    });

    let outLog = '';
    await new Promise<void>((resolve, reject) => {
      child.stdout!.on('data', (data: Buffer) => {
        outLog += data.toString();
        if (outLog.includes('Daemon listening on'))
          resolve();
      });
      child.on('close', (code: number) => {
        const errLogContent = fs.readFileSync(errLog, 'utf-8');
        reject(new Error(`Daemon process exited with code ${code}` + (outLog ? '\n' + outLog : '') + (errLogContent ? '\n' + errLogContent : '')));
      });
    });

    child.stdout!.destroy();
    child.unref();

    return { pid: child.pid };
  }
}

class SocketConnectionClient {
  private _connection: SocketConnection;
  private _nextMessageId = 1;
  private _callbacks = new Map<number, { resolve: (o: any) => void, reject: (e: Error) => void }>();

  constructor(socket: net.Socket) {
    this._connection = new SocketConnection(socket);
    this._connection.onmessage = message => this._onMessage(message);
    this._connection.onclose = () => this._rejectCallbacks();
  }

  async send(method: string, params: any = {}): Promise<any> {
    const messageId = this._nextMessageId++;
    const message = { id: messageId, method, params };
    const responsePromise = new Promise<any>((resolve, reject) => {
      this._callbacks.set(messageId, { resolve, reject });
    });
    const [result] = await Promise.all([responsePromise, this._connection.send(message)]);
    return result;
  }

  static async sendAndClose(socket: net.Socket, method: string, params: any = {}): Promise<any> {
    const connection = new SocketConnectionClient(socket);
    try {
      return await connection.send(method, params);
    } finally {
      connection.close();
    }
  }

  close() {
    this._connection.close();
  }

  private _onMessage(object: { id: number, error?: string, result: any }) {
    if (object.id && this._callbacks.has(object.id)) {
      const callback = this._callbacks.get(object.id)!;
      this._callbacks.delete(object.id);
      if (object.error)
        callback.reject(new Error(object.error));
      else
        callback.resolve(object.result);
    }
  }

  private _rejectCallbacks() {
    for (const callback of this._callbacks.values())
      callback.reject(new Error('Session closed'));
    this._callbacks.clear();
  }
}

export interface ClientInfo {
  version: string;
  workspaceDirHash: string;
  daemonProfilesDir: string;
  workspaceDir: string | undefined;
  homeDir: string;
}

export function createClientInfo(): ClientInfo {
  const workspaceDir = findWorkspaceDir(process.cwd());
  const version = require('../../package.json').version;

  const hash = crypto.createHash('sha1');
  hash.update(workspaceDir || __dirname);
  const workspaceDirHash = hash.digest('hex').substring(0, 16);

  return {
    version,
    workspaceDir,
    workspaceDirHash,
    daemonProfilesDir: daemonProfilesDir(workspaceDirHash),
    homeDir: os.homedir(),
  };
}

function findWorkspaceDir(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.cssprobe-cli')))
      return dir;
    const parentDir = path.dirname(dir);
    if (parentDir === dir)
      break;
    dir = parentDir;
  }
  return undefined;
}

const baseDaemonDir = (() => {
  let localCacheDir: string | undefined;
  if (process.platform === 'linux')
    localCacheDir = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  if (process.platform === 'darwin')
    localCacheDir = path.join(os.homedir(), 'Library', 'Caches');
  if (process.platform === 'win32')
    localCacheDir = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  if (!localCacheDir)
    throw new Error('Unsupported platform: ' + process.platform);
  return path.join(localCacheDir, 'cssprobe-cli', 'daemon');
})();

const daemonProfilesDir = (workspaceDirHash: string) => {
  return path.join(baseDaemonDir, workspaceDirHash);
};

export async function loadSession(): Promise<Session | undefined> {
  const clientInfo = createClientInfo();
  const sessionFile = path.join(clientInfo.daemonProfilesDir, 'default.session');
  
  try {
    const data = await fs.promises.readFile(sessionFile, 'utf-8');
    const config = JSON.parse(data) as SessionConfig;
    return new Session({ file: sessionFile, config, daemonDir: clientInfo.daemonProfilesDir });
  } catch {
    return undefined;
  }
}

export async function saveSession(config: SessionConfig): Promise<void> {
  const clientInfo = createClientInfo();
  await fs.promises.mkdir(clientInfo.daemonProfilesDir, { recursive: true });
  const sessionFile = path.join(clientInfo.daemonProfilesDir, 'default.session');
  await fs.promises.writeFile(sessionFile, JSON.stringify(config, null, 2));
}

export async function deleteSession(): Promise<void> {
  const clientInfo = createClientInfo();
  const sessionFile = path.join(clientInfo.daemonProfilesDir, 'default.session');
  await fs.promises.unlink(sessionFile).catch(() => {});
}
