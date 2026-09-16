import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { installMcpConfig, uninstallMcpConfig } from '../src/installer/mcp';

describe('mcp-install', () => {
  let prevHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    prevHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cssprobe-home-'));
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));

  it('creates claude ~/.claude.json with a stdio entry when missing', () => {
    const result = installMcpConfig('global', 'claude');
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].action, 'created');

    const data = readJson(path.join(tmpHome, '.claude.json'));
    assert.deepEqual(data.mcpServers['cssprobe-cli'], { type: 'stdio', command: 'cssprobe-cli', args: ['mcp'] });
  });

  it('is idempotent on re-install and removes cleanly', () => {
    installMcpConfig('global', 'claude');

    const second = installMcpConfig('global', 'claude');
    assert.equal(second.files[0].action, 'unchanged');

    uninstallMcpConfig('global', 'claude');
    const data = readJson(path.join(tmpHome, '.claude.json'));
    assert.equal(data.mcpServers, undefined);

    const third = uninstallMcpConfig('global', 'claude');
    assert.equal(third.files[0].action, 'not-found');
  });

  it('preserves unrelated keys when updating an existing JSON config (cursor)', () => {
    const cursorDir = path.join(tmpHome, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(
      path.join(cursorDir, 'mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2)
    );

    installMcpConfig('global', 'cursor');
    const data = readJson(path.join(cursorDir, 'mcp.json'));
    assert.deepEqual(data.mcpServers.other, { command: 'x' });
    assert.deepEqual(data.mcpServers['cssprobe-cli'], { type: 'stdio', command: 'cssprobe-cli', args: ['mcp'] });
  });

  it('writes the opencode mcp entry with a local command array', () => {
    const dir = path.join(tmpHome, '.opencode');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'opencode.json'), '{}');

    installMcpConfig('global', 'opencode');
    const data = readJson(path.join(dir, 'opencode.json'));
    assert.deepEqual(data.mcp['cssprobe-cli'], { type: 'local', command: ['cssprobe-cli', 'mcp'], enabled: true });
  });

  it('upserts and removes a TOML table in codex config, preserving other keys', () => {
    const dir = path.join(tmpHome, '.codex');
    fs.mkdirSync(dir, { recursive: true });
    const configPath = path.join(dir, 'config.toml');
    fs.writeFileSync(configPath, 'model = "gpt-5"\n');

    const install = installMcpConfig('global', 'codex');
    assert.equal(install.files[0].action, 'created');

    let content = fs.readFileSync(configPath, 'utf-8');
    assert.match(content, /\[mcp_servers\.cssprobe-cli\]/);
    assert.match(content, /command = "cssprobe-cli"/);
    assert.match(content, /args = \["mcp"\]/);
    assert.match(content, /model = "gpt-5"/);

    const again = installMcpConfig('global', 'codex');
    assert.equal(again.files[0].action, 'unchanged');

    uninstallMcpConfig('global', 'codex');
    content = fs.readFileSync(configPath, 'utf-8');
    assert.ok(!content.includes('mcp_servers'));
    assert.match(content, /model = "gpt-5"/);
  });

  it('leaves invalid JSON untouched and reports a note', () => {
    const cfg = path.join(tmpHome, '.claude.json');
    fs.writeFileSync(cfg, '{ not valid json');

    const result = installMcpConfig('global', 'claude');
    assert.equal(result.files[0].action, 'kept');
    assert.ok(result.notes.length > 0);
    assert.equal(fs.readFileSync(cfg, 'utf-8'), '{ not valid json');
  });

  it('auto detection reports a note when no clients are present', () => {
    const result = installMcpConfig('global', 'auto');
    assert.equal(result.files.length, 0);
    assert.ok(result.notes.some(n => /No MCP client configs detected/.test(n)));
  });

  it('rejects unknown target ids', () => {
    assert.throws(() => installMcpConfig('global', 'bogus'), /Unknown --target id/);
  });
});
