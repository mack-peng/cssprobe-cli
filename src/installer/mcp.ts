import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { atomicWriteFileSync } from './targets/shared';
import { buildTomlTable, upsertTomlTable, removeTomlTable } from './toml';
import type { Location, TargetId } from './targets/types';

export const MCP_SERVER_NAME = 'cssprobe-cli';

export interface McpFileResult {
  path: string;
  action: 'created' | 'updated' | 'unchanged' | 'removed' | 'not-found' | 'kept';
  agent: string;
}

export interface McpCommandResult {
  files: McpFileResult[];
  notes: string[];
}

interface JsonClient {
  id: TargetId;
  displayName: string;
  format: 'json';
  supportsLocal: boolean;
  configPath(loc: Location): string;
  detect(loc: Location): boolean;
  serversKey: 'mcpServers' | 'mcp';
  buildEntry(): unknown;
}

interface TomlClient {
  id: TargetId;
  displayName: string;
  format: 'toml';
  supportsLocal: false;
  configPath(loc: Location): string;
  detect(loc: Location): boolean;
  table: string;
  buildBlock(): string;
}

type McpClient = JsonClient | TomlClient;

const jsonEntry = () => ({ type: 'stdio', command: MCP_SERVER_NAME, args: ['mcp'] });
const opencodeEntry = () => ({ type: 'local', command: [MCP_SERVER_NAME, 'mcp'], enabled: true });

function home(...parts: string[]): string {
  return path.join(os.homedir(), ...parts);
}

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function opencodeGlobalPath(): string {
  const newStyleDir = home('.opencode');
  if (dirExists(newStyleDir) || fileExists(path.join(newStyleDir, 'opencode.json'))) {
    return path.join(newStyleDir, 'opencode.json');
  }
  return home('.config', 'opencode', 'opencode.json');
}

const CLIENTS: McpClient[] = [
  {
    id: 'claude',
    displayName: 'Claude Code',
    format: 'json',
    supportsLocal: true,
    configPath: (loc) => (loc === 'global' ? home('.claude.json') : path.join(process.cwd(), '.mcp.json')),
    detect: (loc) => (loc === 'global' ? fileExists(home('.claude.json')) || dirExists(home('.claude')) : dirExists(path.join(process.cwd(), '.claude'))),
    serversKey: 'mcpServers',
    buildEntry: jsonEntry,
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    format: 'json',
    supportsLocal: true,
    configPath: (loc) => (loc === 'global' ? home('.cursor', 'mcp.json') : path.join(process.cwd(), '.cursor', 'mcp.json')),
    detect: (loc) => dirExists(loc === 'global' ? home('.cursor') : path.join(process.cwd(), '.cursor')),
    serversKey: 'mcpServers',
    buildEntry: jsonEntry,
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    format: 'json',
    supportsLocal: false,
    configPath: () => home('.gemini', 'mcp_settings.json'),
    detect: () => dirExists(home('.gemini')),
    serversKey: 'mcpServers',
    buildEntry: jsonEntry,
  },
  {
    id: 'hermes',
    displayName: 'Hermes',
    format: 'json',
    supportsLocal: false,
    configPath: () => home('.hermes', 'mcp.json'),
    detect: () => dirExists(home('.hermes')),
    serversKey: 'mcpServers',
    buildEntry: jsonEntry,
  },
  {
    id: 'opencode',
    displayName: 'opencode',
    format: 'json',
    supportsLocal: true,
    configPath: (loc) => (loc === 'global' ? opencodeGlobalPath() : path.join(process.cwd(), 'opencode.json')),
    detect: (loc) => dirExists(loc === 'global' ? home('.opencode') : path.join(process.cwd(), '.opencode')) || (loc === 'global' && dirExists(home('.config', 'opencode'))),
    serversKey: 'mcp',
    buildEntry: opencodeEntry,
  },
  {
    id: 'codex',
    displayName: 'Codex CLI',
    format: 'toml',
    supportsLocal: false,
    configPath: () => home('.codex', 'config.toml'),
    detect: () => dirExists(home('.codex')),
    table: `mcp_servers.${MCP_SERVER_NAME}`,
    buildBlock: () => buildTomlTable(`mcp_servers.${MCP_SERVER_NAME}`, { command: MCP_SERVER_NAME, args: ['mcp'] }),
  },
];

function resolveClients(targetFlag: string, loc: Location): { clients: McpClient[]; notes: string[] } {
  const notes: string[] = [];
  const allowed = CLIENTS.filter((c) => loc === 'global' || c.supportsLocal);

  if (targetFlag === 'none') return { clients: [], notes };

  if (targetFlag === 'all') {
    if (loc === 'local') notes.push('Local location only applies to claude / cursor / opencode; other clients are global-only.');
    return { clients: [...allowed], notes };
  }

  if (targetFlag === 'auto') {
    const detected = allowed.filter((c) => c.detect(loc));
    if (detected.length === 0) {
      notes.push('No MCP client configs detected. Use --target=all or --target=<id,...> to force.');
    }
    return { clients: detected, notes };
  }

  const ids = targetFlag.split(',').map((s) => s.trim()).filter(Boolean);
  const resolved: McpClient[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const client = CLIENTS.find((c) => c.id === id);
    if (!client) {
      unknown.push(id);
      continue;
    }
    if (loc === 'local' && !client.supportsLocal) {
      notes.push(`${client.displayName} has no project-local MCP config; skipped.`);
      continue;
    }
    resolved.push(client);
  }
  if (unknown.length > 0) {
    const known = CLIENTS.map((c) => c.id).join(', ');
    throw new Error(`Unknown --target id(s): ${unknown.join(', ')}. Known: ${known}, plus 'auto' / 'all' / 'none'.`);
  }
  return { clients: resolved, notes };
}

function installJson(client: JsonClient, loc: Location): { result: McpFileResult; note?: string } {
  const file = client.configPath(loc);

  if (!fileExists(file)) {
    const data: Record<string, any> = {};
    data[client.serversKey] = { [MCP_SERVER_NAME]: client.buildEntry() };
    atomicWriteFileSync(file, JSON.stringify(data, null, 2) + '\n');
    return { result: { path: file, action: 'created', agent: client.displayName } };
  }

  const raw = fs.readFileSync(file, 'utf-8');
  let data: Record<string, any>;
  try {
    data = JSON.parse(raw);
  } catch {
    return {
      result: { path: file, action: 'kept', agent: client.displayName },
      note: `${file} is not valid JSON — skipped (left untouched).`,
    };
  }

  const before = JSON.stringify(data[client.serversKey]?.[MCP_SERVER_NAME] ?? null);
  const after = JSON.stringify(client.buildEntry());
  if (before === after) {
    return { result: { path: file, action: 'unchanged', agent: client.displayName } };
  }

  if (!data[client.serversKey]) data[client.serversKey] = {};
  data[client.serversKey][MCP_SERVER_NAME] = client.buildEntry();
  atomicWriteFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return { result: { path: file, action: 'updated', agent: client.displayName } };
}

function uninstallJson(client: JsonClient, loc: Location): { result: McpFileResult; note?: string } {
  const file = client.configPath(loc);
  if (!fileExists(file)) {
    return { result: { path: file, action: 'not-found', agent: client.displayName } };
  }

  const raw = fs.readFileSync(file, 'utf-8');
  let data: Record<string, any>;
  try {
    data = JSON.parse(raw);
  } catch {
    return {
      result: { path: file, action: 'kept', agent: client.displayName },
      note: `${file} is not valid JSON — skipped (left untouched).`,
    };
  }

  if (!data[client.serversKey]?.[MCP_SERVER_NAME]) {
    return { result: { path: file, action: 'not-found', agent: client.displayName } };
  }

  delete data[client.serversKey][MCP_SERVER_NAME];
  if (Object.keys(data[client.serversKey]).length === 0) delete data[client.serversKey];
  atomicWriteFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return { result: { path: file, action: 'removed', agent: client.displayName } };
}

function installToml(client: TomlClient, loc: Location): { result: McpFileResult; note?: string } {
  const file = client.configPath(loc);
  const existing = fileExists(file) ? fs.readFileSync(file, 'utf-8') : '';
  const { content, action } = upsertTomlTable(existing, client.table, client.buildBlock());

  if (action === 'unchanged') {
    return { result: { path: file, action: 'unchanged', agent: client.displayName } };
  }

  atomicWriteFileSync(file, content);
  return { result: { path: file, action: action === 'inserted' ? 'created' : 'updated', agent: client.displayName } };
}

function uninstallToml(client: TomlClient, loc: Location): { result: McpFileResult; note?: string } {
  const file = client.configPath(loc);
  if (!fileExists(file)) {
    return { result: { path: file, action: 'not-found', agent: client.displayName } };
  }

  const existing = fs.readFileSync(file, 'utf-8');
  const { content, action } = removeTomlTable(existing, client.table);
  if (action === 'not-found') {
    return { result: { path: file, action: 'not-found', agent: client.displayName } };
  }

  atomicWriteFileSync(file, content);
  return { result: { path: file, action: 'removed', agent: client.displayName } };
}

function run(mode: 'install' | 'uninstall', loc: Location, targetFlag: string): McpCommandResult {
  const { clients, notes } = resolveClients(targetFlag, loc);
  const files: McpFileResult[] = [];

  for (const client of clients) {
    const handled = mode === 'install'
      ? (client.format === 'json' ? installJson(client, loc) : installToml(client, loc))
      : (client.format === 'json' ? uninstallJson(client, loc) : uninstallToml(client, loc));
    files.push(handled.result);
    if (handled.note) notes.push(handled.note);
  }

  return { files, notes };
}

export function installMcpConfig(loc: Location, targetFlag = 'auto'): McpCommandResult {
  return run('install', loc, targetFlag);
}

export function uninstallMcpConfig(loc: Location, targetFlag = 'auto'): McpCommandResult {
  return run('uninstall', loc, targetFlag);
}

export function listMcpClientIds(): TargetId[] {
  return CLIENTS.map((c) => c.id);
}
