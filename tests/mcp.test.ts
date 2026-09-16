import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MCPServer } from '../src/mcp';

const TOOL_NAMES = [
  'cssprobe_open',
  'cssprobe_inspect',
  'cssprobe_tree',
  'cssprobe_layout',
  'cssprobe_findings',
  'cssprobe_eval',
  'cssprobe_screenshot',
  'cssprobe_inject_css',
  'cssprobe_close',
  'cssprobe_status',
];

describe('MCP server', () => {
  let prevCwd: string;
  let tmpDir: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cssprobe-mcp-'));
    // A fresh workspace marker isolates the session lookup from any live session.
    fs.mkdirSync(path.join(tmpDir, '.cssprobe-cli'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initialize returns protocol version, tools capability and instructions', async () => {
    const server = new MCPServer();
    const res: any = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 1);
    assert.equal(res.result.protocolVersion, '2024-11-05');
    assert.deepEqual(res.result.capabilities, { tools: {} });
    assert.equal(res.result.serverInfo.name, 'cssprobe-cli');
    assert.ok(typeof res.result.instructions === 'string' && res.result.instructions.length > 0);
  });

  it('tools/list returns the 10 cssprobe tools with schemas', async () => {
    const server = new MCPServer();
    const res: any = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

    const names = res.result.tools.map((t: any) => t.name);
    assert.equal(names.length, TOOL_NAMES.length);
    for (const name of TOOL_NAMES) assert.ok(names.includes(name), `missing tool: ${name}`);

    for (const tool of res.result.tools) {
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(tool.description.length > 0, `empty description for ${tool.name}`);
    }
  });

  it('notifications produce no response', async () => {
    const server = new MCPServer();
    const res = await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(res, undefined);
  });

  it('ping returns an empty result', async () => {
    const server = new MCPServer();
    const res: any = await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'ping' });
    assert.equal(res.id, 3);
    assert.deepEqual(res.result, {});
  });

  it('unknown method returns a JSON-RPC method-not-found error', async () => {
    const server = new MCPServer();
    const res: any = await server.handleMessage({ jsonrpc: '2.0', id: 4, method: 'no/such' });
    assert.equal(res.error.code, -32601);
  });

  it('session tool without an open session returns guidance instead of an error', async () => {
    const server = new MCPServer();
    const res: any = await server.handleMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'cssprobe_inspect', arguments: { selector: 'body' } },
    });

    assert.equal(res.result.isError, undefined);
    assert.match(res.result.content[0].text, /No active session/);
  });

  it('status tool reports no active session', async () => {
    const server = new MCPServer();
    const res: any = await server.handleMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'cssprobe_status', arguments: {} },
    });

    assert.match(res.result.content[0].text, /No active session/);
  });

  it('unknown tool returns a message inside a normal result', async () => {
    const server = new MCPServer();
    const res: any = await server.handleMessage({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'cssprobe_nope', arguments: {} },
    });

    assert.match(res.result.content[0].text, /Unknown tool/);
  });

  it('tool call without a name returns invalid-params error', async () => {
    const server = new MCPServer();
    const res: any = await server.handleMessage({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: {} });
    assert.equal(res.error.code, -32602);
  });
});
