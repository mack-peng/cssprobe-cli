import { commands } from '../cli/commands';
import { openSession, closeSession, getSessionStatus, runSessionCommand, saveScreenshotFile } from '../cli/session-ops';
import type { OpenOptions } from '../cli/session-ops';
import type { SessionConfig } from '../daemon/session';

const GUIDANCE_PATTERN = /No active session|Browser is not open|Daemon failed to become ready/;

export function getToolDefinitions() {
  return [
    {
      name: 'cssprobe_open',
      description:
        'Open a browser session (non-blocking). Required before any inspect/layout/findings call. ' +
        'Use headed: true when the target page needs a manual login.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string' as const, description: 'URL, file:// path, or local HTML file path (default: about:blank)' },
          headed: { type: 'boolean' as const, description: 'show the browser window (default: false)' },
          viewport: { type: 'string' as const, description: 'viewport size as WxH (e.g. 1280x720)' },
          browser: { type: 'string' as const, enum: ['chromium', 'firefox', 'webkit'], description: 'browser engine (default: chromium)' },
          state: { type: 'string' as const, description: 'path to a saved state file (cookies + localStorage)' },
        },
        required: [],
      },
    },
    {
      name: 'cssprobe_inspect',
      description:
        'Inspect the runtime CSS of an element: DOM tree, computed styles, layout diagram and ' +
        'confidence-classified findings in one call.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          selector: { type: 'string' as const, description: 'CSS selector for the root element (e.g. ".sidebar")' },
          depth: { type: 'number' as const, description: 'DOM tree depth (default: auto, max 20)' },
          brief: { type: 'boolean' as const, description: 'compact output: tree sketch + warnings/errors only' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'cssprobe_tree',
      description: 'Show the DOM tree structure under a selector.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          selector: { type: 'string' as const, description: 'CSS selector for the root element' },
          depth: { type: 'number' as const, description: 'tree depth (default: auto, max 20)' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'cssprobe_layout',
      description: 'Show the ASCII layout diagram (element positions and sizes) for a selector.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          selector: { type: 'string' as const, description: 'CSS selector for the root element' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'cssprobe_findings',
      description: 'Show only issues/warnings/errors with confidence levels for a selector.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          selector: { type: 'string' as const, description: 'CSS selector for the root element' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'cssprobe_eval',
      description: 'Evaluate a JavaScript expression in the browser page context and return the result.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          expression: { type: 'string' as const, description: 'JavaScript expression to evaluate' },
        },
        required: ['expression'],
      },
    },
    {
      name: 'cssprobe_screenshot',
      description: 'Take a screenshot of the page and save it as a PNG file; returns the file path.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          full_page: { type: 'boolean' as const, description: 'capture the full scrollable page (default: viewport only)' },
          out: { type: 'string' as const, description: 'output file path (default: ~/.cssprobe-cli/screenshots/<timestamp>.png)' },
        },
        required: [],
      },
    },
    {
      name: 'cssprobe_inject_css',
      description: 'Inject CSS into the current page (useful for live experiments).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          css: { type: 'string' as const, description: 'CSS code to inject' },
        },
        required: ['css'],
      },
    },
    {
      name: 'cssprobe_close',
      description: 'Close the browser session. Pass all: true to close sessions across all workspaces.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          all: { type: 'boolean' as const, description: 'close all sessions across all workspaces' },
        },
        required: [],
      },
    },
    {
      name: 'cssprobe_status',
      description: 'Show the current session status (alive / dead / none).',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
  ];
}

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class MCPToolHandler {
  private async runSession(commandName: string, parsed: Record<string, unknown>): Promise<string> {
    const command = commands[commandName];
    if (!command) throw new Error(`Unknown command: ${commandName}`);

    try {
      const result = await runSessionCommand(commandName, command, parsed);
      if (commandName === 'screenshot' && typeof result.text === 'string' && result.text.startsWith('data:image/png;base64,')) {
        const saved = saveScreenshotFile(result.text, parsed.out as string | undefined);
        return `Screenshot saved: ${saved}`;
      }
      return result.text;
    } catch (e) {
      const msg = toMessage(e);
      if (GUIDANCE_PATTERN.test(msg)) return msg;
      throw e;
    }
  }

  async open(args: Record<string, unknown>): Promise<string> {
    const opts: OpenOptions = {
      url: typeof args.url === 'string' ? args.url : undefined,
      browser: typeof args.browser === 'string' ? args.browser : undefined,
      headed: args.headed === true,
      state: typeof args.state === 'string' ? args.state : undefined,
    };

    if (typeof args.viewport === 'string') {
      const parts = args.viewport.split('x');
      const width = parseInt(parts[0] || '', 10);
      const height = parseInt(parts[1] || '', 10);
      if (parts.length === 2 && !isNaN(width) && !isNaN(height)) {
        opts.viewport = { width, height };
      } else {
        return 'Invalid viewport format. Use WxH (e.g. 1280x720).';
      }
    }

    try {
      const result = await openSession(opts);
      return [
        `Browser opened at ${result.url}`,
        `Session ID: ${result.sessionId}`,
        `PID: ${result.pid ?? 'unknown'}`,
        `Viewport: ${result.viewport.width}x${result.viewport.height}`,
      ].join('\n');
    } catch (e) {
      const msg = toMessage(e);
      if (GUIDANCE_PATTERN.test(msg)) return msg;
      throw e;
    }
  }

  async inspect(args: Record<string, unknown>): Promise<string> {
    return this.runSession('inspect', {
      selector: args.selector,
      depth: args.depth,
      brief: args.brief,
    });
  }

  async tree(args: Record<string, unknown>): Promise<string> {
    return this.runSession('tree', { selector: args.selector, depth: args.depth });
  }

  async layout(args: Record<string, unknown>): Promise<string> {
    return this.runSession('layout', { selector: args.selector });
  }

  async findings(args: Record<string, unknown>): Promise<string> {
    return this.runSession('findings', { selector: args.selector });
  }

  async evalExpression(args: Record<string, unknown>): Promise<string> {
    return this.runSession('eval', { expression: args.expression });
  }

  async screenshot(args: Record<string, unknown>): Promise<string> {
    return this.runSession('screenshot', { 'full-page': args.full_page, out: args.out });
  }

  async injectCss(args: Record<string, unknown>): Promise<string> {
    return this.runSession('inject-css', { css: args.css });
  }

  async close(args: Record<string, unknown>): Promise<string> {
    try {
      const result = await closeSession(args.all === true);
      return result.sessions
        .map(s => (s.closed ? `Closed: ${s.sessionId}` : `Failed: ${s.sessionId} (${s.error})`))
        .join('\n');
    } catch (e) {
      const msg = toMessage(e);
      if (GUIDANCE_PATTERN.test(msg)) return msg;
      throw e;
    }
  }

  async status(): Promise<string> {
    const result = await getSessionStatus();
    if (!result.config) return 'No active session. Run cssprobe_open to start one.';

    const config = result.config as SessionConfig;
    const lines = [`Session: ${result.sessionId}`, `Status: ${result.alive ? 'alive' : 'dead'}`];
    if (result.alive && config.browser?.browserName) lines.push(`Browser: ${config.browser.browserName}`);
    return lines.join('\n');
  }
}
