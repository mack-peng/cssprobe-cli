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
  }),
});

const close = declareCommand({
  name: 'close',
  category: 'core',
  description: 'Close the browser session',
});

const status = declareCommand({
  name: 'status',
  category: 'core',
  description: 'Show current session status',
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
  }),
});

const layout = declareCommand({
  name: 'layout',
  category: 'cssprobe',
  description: 'Show ASCII layout diagram',
  args: z.object({
    selector: z.string().describe('CSS selector for the root element'),
  }),
});

const findings = declareCommand({
  name: 'findings',
  category: 'cssprobe',
  description: 'Show only issues/warnings/errors',
  args: z.object({
    selector: z.string().describe('CSS selector for the root element'),
  }),
});

const injectCss = declareCommand({
  name: 'inject-css',
  category: 'cssprobe',
  description: 'Inject CSS into the current page',
  args: z.object({
    css: z.string().describe('CSS code to inject'),
  }),
});

// ── browser commands ──

const screenshot = declareCommand({
  name: 'screenshot',
  category: 'export',
  description: 'Take a screenshot of the current page',
  options: z.object({
    'full-page': z.boolean().optional().describe('take screenshot of the full scrollable page'),
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
    expression: z.string().describe('JavaScript expression to evaluate'),
  }),
});

const playwrightCmd = declareCommand({
  name: 'playwright',
  category: 'core',
  description: 'Execute Playwright API call (Node.js context)',
  args: z.object({
    call: z.string().describe('Playwright API call, e.g. "page.setViewportSize({width: 1280, height: 720})"'),
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
    merge: z.string().optional().describe('existing state file to merge into'),
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

// ── export ──

const commandsArray: AnyCommandSchema[] = [
  // session management
  open, close, status,
  // cssprobe
  inspect, tree, layout, findings, injectCss,
  // browser
  resize, evalCmd, playwrightCmd, screenshot,
  // state
  stateImport,
  // config
  configShow, configSet, configList, configUse, configNew, configPath,
  // skill
  skillInstall, skillUninstall,
];

export const commands = Object.fromEntries(commandsArray.map(cmd => [cmd.name, cmd]));
export const inspectCommand = inspect;
