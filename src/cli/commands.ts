import * as z from 'zod';
import { declareCommand } from './command';
import type { AnyCommandSchema } from './command';

const numberArg = z.preprocess((val, ctx) => {
  const number = Number(val);
  if (Number.isNaN(number)) {
    ctx.addIssue({ code: 'custom', message: `expected number, received '${val}'` });
  }
  return number;
}, z.number());

const urlArg = z.string().describe('URL, file:// path, or local HTML file path');

// ── session management ──

const open = declareCommand({
  name: 'open',
  category: 'core',
  description: 'Open browser in session mode (non-blocking)',
  args: z.object({
    url: urlArg.optional(),
  }),
  options: z.object({
    browser: z.enum(['chromium', 'firefox', 'webkit']).optional().describe('browser engine (default chromium)'),
    headed: z.boolean().optional().describe('show the browser window'),
    viewport: z.string().optional().describe('viewport size as WxH (e.g. 1280x720)'),
    state: z.string().optional().describe('path to saved state file (cookies + localStorage)'),
    'expect-url': z.string().optional().describe('regex the final page URL must match'),
    'fail-on-login': z.boolean().optional().describe('fail when the page redirects to a login URL'),
  }),
});

const close = declareCommand({
  name: 'close',
  category: 'core',
  description: 'Close the browser session',
  options: z.object({
    all: z.boolean().optional().describe('close all sessions across all workspaces'),
  }),
});

const status = declareCommand({
  name: 'status',
  category: 'core',
  description: 'Show current session status',
});

const framesCmd = declareCommand({
  name: 'frames',
  category: 'core',
  description: 'List frames in the current page',
});

const scenarioCmd = declareCommand({
  name: 'scenario',
  category: 'core',
  description: 'Run a JSON scenario suite (regression cases, artifacts, JUnit)',
  args: z.object({
    action: z.literal('run').describe('only "run" is supported'),
    file: z.string().describe('scenario suite JSON path'),
  }),
  options: z.object({
    state: z.string().optional().describe('fallback state file when the suite/case does not set one'),
    artifacts: z.string().optional().describe('artifact directory (default: ~/.cssprobe-cli/scenario-runs/<suite>-<timestamp>)'),
    junit: z.string().optional().describe('write a JUnit XML report to this path'),
    bail: z.boolean().optional().describe('stop after the first failing case'),
    headed: z.boolean().optional().describe('show the browser window'),
    browser: z.enum(['chromium', 'firefox', 'webkit']).optional().describe('browser engine (default chromium)'),
    viewport: z.string().optional().describe('viewport size as WxH (default: suite defaults or 1280x720)'),
  }),
});

const doctor = declareCommand({
  name: 'doctor',
  category: 'core',
  description: 'Diagnose browser installation and Playwright revision mismatch',
  options: z.object({
    engine: z.string().optional().describe('browser engine: chromium, firefox, webkit (default: chromium)'),
  }),
});

// ── cssprobe commands ──

const inspect = declareCommand({
  name: 'inspect',
  category: 'cssprobe',
  description: 'Inspect the runtime CSS of a page element',
  args: z.object({
    selector: z.string().describe('CSS selector for the root element'),
  }),
  options: z.object({
    json: z.boolean().optional().describe('output structured JSON instead of Markdown'),
    brief: z.boolean().optional().describe('compact output: tree sketch + warnings/errors only'),
    layout: z.boolean().optional().describe('ASCII layout diagram showing element positions and sizes'),
    depth: numberArg.optional().describe('DOM tree depth (default: auto, max 20)'),
    frame: z.string().optional().describe('target frame: index, name, or URL substring (default: main frame)'),
  }),
});

const tree = declareCommand({
  name: 'tree',
  category: 'cssprobe',
  description: 'Show DOM tree structure',
  args: z.object({
    selector: z.string().describe('CSS selector for the root element'),
  }),
  options: z.object({
    depth: numberArg.optional().describe('tree depth (default: auto, max 20)'),
    frame: z.string().optional().describe('target frame: index, name, or URL substring (default: main frame)'),
  }),
});

const layout = declareCommand({
  name: 'layout',
  category: 'cssprobe',
  description: 'Show ASCII layout diagram',
  args: z.object({
    selector: z.string().describe('CSS selector for the root element'),
  }),
  options: z.object({
    frame: z.string().optional().describe('target frame: index, name, or URL substring (default: main frame)'),
  }),
});

const findings = declareCommand({
  name: 'findings',
  category: 'cssprobe',
  description: 'Show only issues/warnings/errors',
  args: z.object({
    selector: z.string().describe('CSS selector for the root element'),
  }),
  options: z.object({
    frame: z.string().optional().describe('target frame: index, name, or URL substring (default: main frame)'),
  }),
});

const injectCss = declareCommand({
  name: 'inject-css',
  category: 'cssprobe',
  description: 'Inject CSS into the current page',
  args: z.object({
    css: z.string().describe('CSS code to inject'),
  }),
  options: z.object({
    frame: z.string().optional().describe('target frame: index, name, or URL substring (default: main frame)'),
  }),
});

// ── browser commands ──

const screenshot = declareCommand({
  name: 'screenshot',
  category: 'export',
  description: 'Take a screenshot of the current page',
  options: z.object({
    'full-page': z.boolean().optional().describe('take screenshot of the full scrollable page'),
    out: z.string().optional().describe('output file path (default: ~/.cssprobe-cli/screenshots/<timestamp>.png)'),
  }),
});

const resize = declareCommand({
  name: 'resize',
  category: 'core',
  description: 'Resize the browser viewport',
  args: z.object({
    width: numberArg.describe('viewport width'),
    height: numberArg.describe('viewport height'),
  }),
});

const evalCmd = declareCommand({
  name: 'eval',
  category: 'core',
  description: 'Evaluate JavaScript expression on the page (browser context)',
  args: z.object({
    expression: z.string().describe('JavaScript expression, or @file / - (stdin) for long scripts'),
  }),
  options: z.object({
    frame: z.string().optional().describe('target frame: index, name, or URL substring (default: main frame)'),
  }),
});

const playwrightCmd = declareCommand({
  name: 'playwright',
  category: 'core',
  description: 'Execute Playwright API call (Node.js context)',
  args: z.object({
    call: z.string().describe('Playwright API call, or @file / - (stdin); e.g. "page.setViewportSize({width: 1280, height: 720})"'),
  }),
});

// ── interaction ──

const click = declareCommand({
  name: 'click',
  category: 'core',
  description: 'Click an element with real mouse events (works with custom React components)',
  args: z.object({
    selector: z.string().describe('CSS selector'),
  }),
  options: z.object({
    nth: numberArg.optional().describe('1-based match index (default: first match)'),
    force: z.boolean().optional().describe('skip actionability checks'),
    timeout: numberArg.optional().describe('action timeout in ms (default 30000)'),
  }),
});

const hover = declareCommand({
  name: 'hover',
  category: 'core',
  description: 'Hover an element with real mouse events',
  args: z.object({
    selector: z.string().describe('CSS selector'),
  }),
  options: z.object({
    nth: numberArg.optional().describe('1-based match index (default: first match)'),
    force: z.boolean().optional().describe('skip actionability checks'),
    timeout: numberArg.optional().describe('action timeout in ms (default 30000)'),
  }),
});

const typeCmd = declareCommand({
  name: 'type',
  category: 'core',
  description: 'Type text into an element (fill by default; --sequential for real key events)',
  args: z.object({
    selector: z.string().describe('CSS selector'),
    text: z.string().describe('text to type'),
  }),
  options: z.object({
    press: z.string().optional().describe('key to press after typing (e.g. Enter, Tab, Control+A)'),
    sequential: z.boolean().optional().describe('type with real key events (for custom editors)'),
    clear: z.boolean().optional().describe('clear existing content before sequential typing'),
    delay: numberArg.optional().describe('delay between keystrokes in ms (--sequential, default 0)'),
    nth: numberArg.optional().describe('1-based match index (default: first match)'),
    timeout: numberArg.optional().describe('action timeout in ms (default 30000)'),
  }),
});

const waitForCmd = declareCommand({
  name: 'wait-for',
  category: 'core',
  description: 'Wait for a condition: selector state, JS predicate, or network idle',
  args: z.object({
    selector: z.string().optional().describe('CSS selector to wait for'),
  }),
  options: z.object({
    state: z.enum(['visible', 'hidden', 'attached', 'detached']).optional().describe('selector state to wait for (default visible)'),
    js: z.string().optional().describe('JS predicate, e.g. "() => document.querySelector(\'.x\')?.offsetHeight > 100"'),
    'network-idle': z.boolean().optional().describe('wait until the page is network-idle'),
    frame: z.string().optional().describe('wait inside a frame: index, name, or URL substring'),
    timeout: numberArg.optional().describe('timeout in ms (default 30000)'),
  }),
});

const sampleCmd = declareCommand({
  name: 'sample',
  category: 'core',
  description: 'Sample a JS expression over time and return a timeline with summary stats',
  args: z.object({
    expression: z.string().describe('JS expression sampled on an interval'),
  }),
  options: z.object({
    interval: numberArg.optional().describe('sampling interval in ms (default 250)'),
    duration: numberArg.optional().describe('total sampling duration in ms (default 5000)'),
    key: z.string().optional().describe('dot path for numeric extraction, e.g. "top" or "box.y"'),
    'tail-from': numberArg.optional().describe('tail starts at this elapsed ms (default: last 5000ms)'),
    'ignore-errors': z.boolean().optional().describe('record evaluation errors as sample points instead of aborting'),
    frame: z.string().optional().describe('target frame: index, name, or URL substring (default: main frame)'),
  }),
});

const waitStableCmd = declareCommand({
  name: 'wait-stable',
  category: 'core',
  description: 'Wait until a JS expression stops changing (tolerance + stable window)',
  args: z.object({
    expression: z.string().describe('JS expression polled until stable'),
  }),
  options: z.object({
    tolerance: numberArg.optional().describe('absolute tolerance for numeric values (default 0)'),
    window: numberArg.optional().describe('stable window in ms (default 1500)'),
    timeout: numberArg.optional().describe('timeout in ms (default 30000)'),
    interval: numberArg.optional().describe('polling interval in ms (default 200)'),
    frame: z.string().optional().describe('target frame: index, name, or URL substring (default: main frame)'),
  }),
});

const runCmd = declareCommand({
  name: 'run',
  category: 'core',
  description: 'Run a multi-step flow script (default-exports an async function receiving the API object)',
  args: z.object({
    file: z.string().describe('flow script path (.js / .mjs / .cjs)'),
  }),
  options: z.object({
    timeout: numberArg.optional().describe('whole-script timeout in ms (default 300000, 0 = unlimited)'),
  }),
});

// ── state management ──

const stateImport = declareCommand({
  name: 'state-import',
  category: 'core',
  description: 'Import cookies from Netscape format file',
  args: z.object({
    file: z.string().optional().describe('Netscape cookie file path (reads from stdin if omitted)'),
  }),
  options: z.object({
    out: z.string().optional().describe('output state file path (default: ~/.cssprobe-cli/states/imported.json)'),
    name: z.string().optional().describe('custom name for the state file (e.g. mysite or mysite.json)'),
    merge: z.string().optional().describe('existing state file to merge into'),
  }),
});

const stateSave = declareCommand({
  name: 'state-save',
  category: 'core',
  description: 'Save current browser session state (cookies + localStorage)',
  options: z.object({
    name: z.string().optional().describe('state file name (default: session)'),
  }),
});

const stateCheck = declareCommand({
  name: 'state-check',
  category: 'core',
  description: 'Validate a saved state file: cookies, expiry, and target domain coverage',
  options: z.object({
    state: z.string().optional().describe('state file path (default: ~/.cssprobe-cli/states/session.json)'),
    url: z.string().optional().describe('target URL whose hostname must be covered by the cookies'),
  }),
});

// ── config ──

const configShow = declareCommand({
  name: 'config-show',
  category: 'config',
  description: 'Show current configuration',
  options: z.object({
    profile: z.string().optional().describe('profile name'),
  }),
});

const configSet = declareCommand({
  name: 'config-set',
  category: 'config',
  description: 'Set a configuration value',
  args: z.object({
    key: z.string().describe('Config key (browser, depth, headed, viewport)'),
    value: z.string().describe('Config value'),
  }),
  options: z.object({
    profile: z.string().optional().describe('profile name'),
  }),
});

const configList = declareCommand({
  name: 'config-list',
  category: 'config',
  description: 'List all profiles',
});

const configUse = declareCommand({
  name: 'config-use',
  category: 'config',
  description: 'Switch active profile',
  args: z.object({
    name: z.string().describe('Profile name'),
  }),
});

const configNew = declareCommand({
  name: 'config-new',
  category: 'config',
  description: 'Create a new profile',
  args: z.object({
    name: z.string().describe('Profile name'),
  }),
});

const configPath = declareCommand({
  name: 'config-path',
  category: 'config',
  description: 'Show configuration file path',
});

// ── skill ──

const skillInstall = declareCommand({
  name: 'skill-install',
  category: 'skill',
  description: 'Install Agent Skill for cssprobe-cli',
  options: z.object({
    target: z.string().optional().describe('agent target: auto, all, opencode, claude, codex, cursor, hermes, gemini (default: auto)'),
    local: z.boolean().optional().describe('install to current directory instead of home'),
    path: z.string().optional().describe('custom base directory (overrides home/current)'),
  }),
});

const skillUninstall = declareCommand({
  name: 'skill-uninstall',
  category: 'skill',
  description: 'Remove Agent Skill for cssprobe-cli',
  options: z.object({
    target: z.string().optional().describe('agent target: auto, all, opencode, claude, codex, cursor, hermes, gemini (default: auto)'),
    local: z.boolean().optional().describe('remove from current directory instead of home'),
    path: z.string().optional().describe('custom base directory'),
  }),
});

// ── mcp ──

const mcp = declareCommand({
  name: 'mcp',
  category: 'core',
  description: 'Start MCP server (stdio transport) for AI clients',
});

const mcpInstall = declareCommand({
  name: 'mcp-install',
  category: 'core',
  description: 'Install MCP server config into AI client configs',
  options: z.object({
    target: z.string().optional().describe('client target: auto, all, none, claude, cursor, codex, opencode, hermes, gemini (default: auto)'),
    local: z.boolean().optional().describe('write project-local config instead of global'),
  }),
});

const mcpUninstall = declareCommand({
  name: 'mcp-uninstall',
  category: 'core',
  description: 'Remove MCP server config from AI client configs',
  options: z.object({
    target: z.string().optional().describe('client target: auto, all, none, claude, cursor, codex, opencode, hermes, gemini (default: auto)'),
    local: z.boolean().optional().describe('remove project-local config instead of global'),
  }),
});

// ── export ──

const commandsArray: AnyCommandSchema[] = [
  // session management
  open, close, status, framesCmd, doctor, scenarioCmd,
  // cssprobe
  inspect, tree, layout, findings, injectCss,
  // browser
  resize, evalCmd, playwrightCmd, screenshot,
  // interaction
  click, hover, typeCmd, waitForCmd, sampleCmd, waitStableCmd, runCmd,
  // state
  stateImport, stateSave, stateCheck,
  // config
  configShow, configSet, configList, configUse, configNew, configPath,
  // skill
  skillInstall, skillUninstall,
  // mcp
  mcp, mcpInstall, mcpUninstall,
];

export const commands = Object.fromEntries(commandsArray.map(cmd => [cmd.name, cmd]));
export const inspectCommand = inspect;
