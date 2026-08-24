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

// ── core ──

const inspect = declareCommand({
  name: 'inspect',
  category: 'core',
  description: 'Inspect the runtime CSS of a page (layout, scroll, colors, fonts, backgrounds)',
  args: z.object({
    url: urlArg,
    selector: z.string().optional().describe('CSS selector for the root element (auto-detected if omitted)'),
  }),
  options: z.object({
    json: z.boolean().optional().describe('output structured JSON instead of Markdown'),
    headed: z.boolean().optional().describe('show the browser window'),
    browser: z.enum(['chromium', 'firefox', 'webkit']).optional().describe('browser engine (default chromium)'),
    zoom: z.boolean().optional().describe('run 1x/0.5x viewport diagnosis'),
    depth: numberArg.optional().describe('DOM tree depth (default 6)'),
    'max-nodes': numberArg.optional().describe('node count cap (default 60)'),
    'up-to': z.string().optional().describe('ancestor stop tag (default html)'),
    state: z.string().optional().describe('path to saved state file (cookies + localStorage)'),
  }),
});

const login = declareCommand({
  name: 'login',
  category: 'core',
  description: 'Open browser for interactive login, then save state for later use',
  args: z.object({
    url: urlArg,
  }),
  options: z.object({
    browser: z.enum(['chromium', 'firefox', 'webkit']).optional().describe('browser engine (default chromium)'),
    out: z.string().optional().describe('output state file path (default: ~/.cssprobe-cli/states/<domain>.json)'),
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
    key: z.string().describe('Config key (browser, depth, headed)'),
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
  description: 'Install Agent Skill for cssprobe-cli (teaches agents how to use the CLI)',
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

const stateImport = declareCommand({
  name: 'state-import',
  category: 'core',
  description: 'Import cookies from Netscape format file into a Playwright state file',
  args: z.object({
    file: z.string().optional().describe('Netscape cookie file path (reads from stdin if omitted)'),
  }),
  options: z.object({
    out: z.string().optional().describe('output state file path (default: ~/.cssprobe-cli/states/imported.json)'),
    merge: z.string().optional().describe('existing state file to merge into'),
  }),
});

const commandsArray: AnyCommandSchema[] = [
  inspect, login, stateImport,
  configShow, configSet, configList, configUse, configNew, configPath,
  skillInstall, skillUninstall,
];

export const commands = Object.fromEntries(commandsArray.map(cmd => [cmd.name, cmd]));
export const inspectCommand = inspect;
