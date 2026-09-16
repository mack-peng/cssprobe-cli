import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { SERVER_INSTRUCTIONS } from './server-instructions';
import { MCPToolHandler, getToolDefinitions } from './tools';

const PROTOCOL_VERSION = '2024-11-05';

export class MCPServer {
  private rl: readline.Interface | null = null;
  private handler = new MCPToolHandler();
  private version: string;
  private pending = 0;
  private closing = false;
  private queue: Promise<void> = Promise.resolve();

  constructor() {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));
      this.version = pkg.version || '0.0.0';
    } catch {
      this.version = '0.0.0';
    }
  }

  async run(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    process.stderr.write('cssprobe-cli MCP server started\n');

    // Requests are serialized: tool calls share one browser session, so an
    // inspect racing an in-flight open must be queued, not run concurrently.
    this.rl.on('line', (line: string) => {
      this.pending++;
      this.queue = this.queue.then(async () => {
        try {
          const message = JSON.parse(line);
          const response = await this.handleMessage(message);
          if (response) this.send(response);
        } catch {
          // ignore malformed lines
        } finally {
          this.pending--;
          if (this.closing && this.pending === 0) process.exit(0);
        }
      });
    });

    // Exit only after in-flight requests drain, so a client that closes
    // stdin immediately after sending still receives its responses.
    this.rl.on('close', () => {
      this.closing = true;
      if (this.pending === 0) process.exit(0);
    });

    process.on('SIGTERM', () => process.exit(0));
    process.on('SIGINT', () => process.exit(0));
  }

  async handleMessage(message: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const method = message['method'] as string | undefined;
    const id = message['id'] as number | string | undefined;
    if (!method) return undefined;

    // Notifications (no id) never receive a response.
    if (id === undefined) return undefined;

    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'cssprobe-cli', version: this.version },
            instructions: SERVER_INSTRUCTIONS,
          },
        };
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: getToolDefinitions() } };
      case 'tools/call':
        return this.handleToolCall(message, id);
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  }

  private async handleToolCall(
    message: Record<string, unknown>,
    id: number | string
  ): Promise<Record<string, unknown>> {
    const params = message['params'] as Record<string, unknown> | undefined;
    const toolName = params?.['name'] as string | undefined;
    const args = (params?.['arguments'] as Record<string, unknown>) ?? {};

    if (!toolName) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } };
    }

    try {
      const text = await this.executeTool(toolName, args);
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `cssprobe-cli internal error: ${msg}\n\nThis is an unexpected error — please report it.` }],
          isError: true,
        },
      };
    }
  }

  private executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'cssprobe_open':        return this.handler.open(args);
      case 'cssprobe_inspect':     return this.handler.inspect(args);
      case 'cssprobe_tree':        return this.handler.tree(args);
      case 'cssprobe_layout':      return this.handler.layout(args);
      case 'cssprobe_findings':    return this.handler.findings(args);
      case 'cssprobe_eval':        return this.handler.evalExpression(args);
      case 'cssprobe_screenshot':  return this.handler.screenshot(args);
      case 'cssprobe_inject_css':  return this.handler.injectCss(args);
      case 'cssprobe_close':       return this.handler.close(args);
      case 'cssprobe_status':      return this.handler.status();
      default:                     return Promise.resolve(`Unknown tool: ${name}`);
    }
  }

  private send(message: Record<string, unknown>): void {
    process.stdout.write(JSON.stringify(message) + '\n');
  }
}

export async function runMcpServer(): Promise<void> {
  await new MCPServer().run();
}
