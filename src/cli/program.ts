import fs from 'fs';
import path from 'path';
import os from 'os';
import { minimist } from './minimist';
import { parseCommand } from './command';
import { commands } from './commands';
import { TextOutput, JsonOutput } from './output';
import { loadConfig, maskConfig, writeRcConfig, getRcConfig, setActiveProfile, createProfile, rcFilePath } from '../config/config';
import { loadSession } from '../daemon/session';
import { openSession, closeSession, getSessionStatus, runSessionCommand, saveScreenshotFile } from './session-ops';
import { runMcpServer } from '../mcp';
import type { Output } from './output';
import type { MinimistArgs } from './minimist';
import type { AnyCommandSchema, HelpData, HelpEntry } from './command';
import type { CollectConfig } from '../engine/types';

const globalOptions = ['json', 'raw', 'help', 'h', 'version', 'v', 'p', 'profile'];
const booleanGlobalOptions = ['help', 'json', 'raw', 'version', 'v', 'h'];

export async function program() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));
  const help: HelpData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'help.json'), 'utf-8'));

  const rawArgs = parseArgs(help);
  if (rawArgs.p && !rawArgs.profile) { rawArgs.profile = rawArgs.p; delete rawArgs.p; }

  const output: Output = rawArgs.json
    ? new JsonOutput()
    : new TextOutput(!!rawArgs.raw);

  const commandName = rawArgs._[0];
  const cmdEntry = commandName ? help.commands[commandName] : undefined;
  const command: AnyCommandSchema | undefined = commands[commandName];

  handleGlobalFlags(rawArgs, commandName, cmdEntry, help, output, pkg.version);

  if (!cmdEntry || !command)
    output.error(`Unknown command: ${commandName}. Run 'cssprobe-cli --help' for usage.`);

  validateFlags(rawArgs, cmdEntry!);

  if (handleConfigCommands(commandName!, command!, rawArgs, output))
    return;

  if (handleSkillCommands(commandName!, command!, rawArgs, output))
    return;

  if (handleMcpInstallCommands(commandName!, command!, rawArgs, output))
    return;

  // Session-based commands
  switch (commandName) {
    case 'mcp':
      await runMcpServer();
      return;
    case 'open':
      await handleOpen(command!, rawArgs, output);
      return;
    case 'close':
      await handleClose(command!, rawArgs, output);
      return;
    case 'status':
      await handleStatus(output);
      return;
    case 'state-import':
      await handleStateImport(command!, rawArgs, output);
      return;
    case 'state-save':
      await handleStateSave(command!, rawArgs, output);
      return;
    case 'inspect':
    case 'tree':
    case 'layout':
    case 'findings':
    case 'inject-css':
    case 'screenshot':
    case 'eval':
    case 'resize':
    case 'playwright':
      await handleSessionCommand(commandName!, command!, rawArgs, output);
      return;
  }

  output.error(`Unknown command: ${commandName}. Run 'cssprobe-cli --help' for usage.`);
}

function parseArgs(help: HelpData): MinimistArgs {
  return minimist(process.argv.slice(2), {
    boolean: [...help.booleanOptions, ...booleanGlobalOptions],
    string: ['_'],
  });
}

function handleGlobalFlags(
  args: MinimistArgs,
  commandName: string | undefined,
  cmdEntry: HelpEntry | undefined,
  help: HelpData,
  output: Output,
  version: string
): void {
  if (args.version || args.v) {
    output.version(version);
    process.exit(0);
  }

  if (args.help || args.h || !commandName) {
    output.help(cmdEntry ? cmdEntry.help : help.global);
    process.exit(0);
  }
}

function splitArgs(args: MinimistArgs): MinimistArgs {
  const result: MinimistArgs = { _: args._ };
  for (const key of Object.keys(args)) {
    if (key === '_' || globalOptions.includes(key)) continue;
    result[key] = args[key];
  }
  return result;
}

function validateFlags(args: MinimistArgs, cmdEntry: { flags: Record<string, 'boolean' | 'string'> }) {
  const unknownFlags: string[] = [];
  for (const key of Object.keys(args)) {
    if (key === '_') continue;
    if (globalOptions.includes(key)) continue;
    if (!(key in cmdEntry.flags))
      unknownFlags.push(key);
  }
  if (unknownFlags.length)
    throw new Error(`Unknown option${unknownFlags.length > 1 ? 's' : ''}: ${unknownFlags.map(f => `--${f}`).join(', ')}`);
}

// ── session commands ──

async function handleOpen(
  command: AnyCommandSchema,
  args: MinimistArgs,
  output: Output
) {
  try {
    const cmdArgs = splitArgs(args);
    const parsed = parseCommand(command, cmdArgs as Record<string, string> & { _: string[] });

    // Parse viewport
    const viewportStr = parsed.viewport as string | undefined;
    let viewport: { width: number; height: number } | undefined;
    if (viewportStr) {
      const parts = viewportStr.split('x');
      if (parts.length !== 2) {
        output.error('Invalid viewport format. Use WxH (e.g. 1280x720)');
        return;
      }
      const width = parseInt(parts[0], 10);
      const height = parseInt(parts[1], 10);
      if (isNaN(width) || isNaN(height)) {
        output.error('Invalid viewport dimensions. Must be numbers.');
        return;
      }
      viewport = { width, height };
    }

    const result = await openSession({
      url: parsed.url as string | undefined,
      browser: parsed.browser as string | undefined,
      headed: !!parsed.headed,
      viewport,
      state: parsed.state as string | undefined,
    });

    if (output.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Browser opened at ${result.url}`);
      console.log(`Session ID: ${result.sessionId}`);
      console.log(`PID: ${result.pid}`);
      console.log(`Viewport: ${result.viewport.width}x${result.viewport.height}`);
    }
  } catch (e: any) {
    output.error(e instanceof Error ? e.message : String(e));
  }
}

async function handleClose(command: AnyCommandSchema, args: MinimistArgs, output: Output) {
  try {
    const cmdArgs = splitArgs(args);
    const parsed = parseCommand(command, cmdArgs as Record<string, string> & { _: string[] });

    const result = await closeSession(!!parsed.all);

    if (output.json) {
      console.log(JSON.stringify(
        parsed.all ? { closed: result.sessions } : { closed: true, sessionId: 'default' },
        null,
        2
      ));
    } else if (parsed.all) {
      const closedCount = result.sessions.filter(r => r.closed).length;
      console.log(`Closed ${closedCount} session(s).`);
    } else {
      console.log('Browser closed.');
    }
  } catch (e: any) {
    output.error(e instanceof Error ? e.message : String(e));
  }
}

async function handleStatus(output: Output) {
  try {
    const result = await getSessionStatus();

    if (output.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (!result.config) {
      console.log('No active session.');
      return;
    }

    console.log(`Session: default`);
    console.log(`Status: ${result.alive ? 'alive' : 'dead'}`);
    if (result.alive) {
      console.log(`Browser: ${result.config.browser.browserName}`);
    }
  } catch (e: any) {
    output.error(e instanceof Error ? e.message : String(e));
  }
}

async function handleSessionCommand(
  commandName: string,
  command: AnyCommandSchema,
  args: MinimistArgs,
  output: Output
) {
  try {
    const cmdArgs = splitArgs(args);
    const parsed = parseCommand(command, cmdArgs as Record<string, string> & { _: string[] });

    const result = await runSessionCommand(commandName, command, parsed, !!args.json);

    // Screenshot: save the base64 data URL to a file and report the path
    if (commandName === 'screenshot' && typeof result.text === 'string' && result.text.startsWith('data:image/png;base64,')) {
      const saved = saveScreenshotFile(result.text, parsed.out as string | undefined);
      if (output.json) {
        console.log(JSON.stringify({ saved }, null, 2));
      } else {
        console.log(`Screenshot saved: ${saved}`);
      }
      return;
    }

    console.log(result.text);
  } catch (e: any) {
    output.error(e instanceof Error ? e.message : String(e));
  }
}

// ── config commands ──

function handleConfigCommands(
  commandName: string,
  command: AnyCommandSchema,
  args: MinimistArgs,
  output: Output
): boolean {
  try {
    const cmdArgs = splitArgs(args);
    const parsed = parseCommand(command, cmdArgs as Record<string, string> & { _: string[] });

    switch (commandName) {
      case 'config-show': {
        const profileName = (parsed.profile as string) || (args.profile as string) || undefined;
        if (profileName) {
          const rc = getRcConfig();
          const profile = rc.profiles[profileName];
          if (!profile) output.error(`Profile '${profileName}' not found`);
          console.log(output.format({ active: rc.active, profile: profileName, ...profile }));
          return true;
        }
        const config = loadConfig(args);
        console.log(output.format(maskConfig(config)));
        return true;
      }
      case 'config-set': {
        const profileName = (parsed.profile as string) || (args.profile as string) || undefined;
        const result = writeRcConfig(parsed.key, parsed.value, profileName);
        console.log(output.format(result));
        return true;
      }
      case 'config-path': {
        console.log(output.format(rcFilePath));
        return true;
      }
      case 'config-list': {
        const rc = getRcConfig();
        const profiles = Object.entries(rc.profiles).map(([name, p]) => ({
          name,
          active: name === rc.active,
          ...p,
        }));
        console.log(output.format(profiles));
        return true;
      }
      case 'config-use': {
        setActiveProfile(parsed.name);
        console.log(output.format({ active: parsed.name }));
        return true;
      }
      case 'config-new': {
        createProfile(parsed.name);
        console.log(output.format({ created: parsed.name }));
        return true;
      }
    }
  } catch (e: any) {
    output.error(e instanceof Error ? e.message : String(e));
  }

  return false;
}

// ── skill commands ──

import { resolveTargetFlag, installMcpConfig, uninstallMcpConfig, type Location } from '../installer';

function handleSkillCommands(
  commandName: string,
  command: AnyCommandSchema,
  args: MinimistArgs,
  output: Output
): boolean {
  if (commandName !== 'skill-install' && commandName !== 'skill-uninstall') return false;

  const targetFlag = (args.target as string) || 'auto';
  const loc: Location = args.local ? 'local' : 'global';
  const baseDir = (args.path as string) || os.homedir();

  try {
    const targets = resolveTargetFlag(targetFlag, loc);
    if (targets.length === 0) {
      console.log(output.format({ installed: [], note: 'no targets selected (--target=none)' }));
      return true;
    }

    const files: Array<{ path: string; action: string; agent: string }> = [];

    for (const target of targets) {
      const result = commandName === 'skill-install'
        ? target.install(loc)
        : target.uninstall(loc);
      for (const f of result.files) {
        if (args.path) {
          const rel = f.path.replace(os.homedir(), '').replace(/^\//, '');
          f.path = path.join(baseDir, rel);
        }
        files.push({ ...f, agent: target.displayName });
      }
    }

    const summary = files.map(f => `${f.agent}: ${f.action} ${f.path}`);
    console.log(output.format({ files: summary }));
    return true;
  } catch (e: any) {
    output.error(e instanceof Error ? e.message : String(e));
  }

  return false;
}

// ── mcp-install commands ──

function handleMcpInstallCommands(
  commandName: string,
  command: AnyCommandSchema,
  args: MinimistArgs,
  output: Output
): boolean {
  if (commandName !== 'mcp-install' && commandName !== 'mcp-uninstall') return false;

  const targetFlag = (args.target as string) || 'auto';
  const loc: Location = args.local ? 'local' : 'global';

  try {
    const result = commandName === 'mcp-install'
      ? installMcpConfig(loc, targetFlag)
      : uninstallMcpConfig(loc, targetFlag);

    const summary = result.files.map(f => `${f.agent}: ${f.action} ${f.path}`);
    for (const note of result.notes) summary.push(`note: ${note}`);
    console.log(output.format({ files: summary }));
    return true;
  } catch (e: any) {
    output.error(e instanceof Error ? e.message : String(e));
  }

  return false;
}

// ── state-import ──

interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

interface PlaywrightState {
  cookies: PlaywrightCookie[];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

function parseNetscapeCookies(content: string): PlaywrightCookie[] {
  const cookies: PlaywrightCookie[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split('\t');
    if (parts.length < 7) continue;

    const [domain, httpOnly, path, secure, expires, name, ...valueParts] = parts;
    const value = valueParts.join('\t');
    const expiresNum = parseInt(expires, 10);

    cookies.push({
      name,
      value,
      domain,
      path: path || '/',
      expires: isNaN(expiresNum) || expiresNum === 0 ? -1 : expiresNum,
      httpOnly: httpOnly === 'TRUE',
      secure: secure === 'TRUE',
      sameSite: secure === 'TRUE' ? 'None' : 'Lax',
    });
  }

  return cookies;
}

async function handleStateImport(
  command: AnyCommandSchema,
  args: MinimistArgs,
  output: Output
) {
  try {
    const cmdArgs = splitArgs(args);
    const parsed = parseCommand(command, cmdArgs as Record<string, string> & { _: string[] });

    const filePath = parsed.file as string | undefined;
    const name = parsed.name as string | undefined;
    let outPath = parsed.out as string | undefined;
    
    if (!outPath && name) {
      // Use custom name in default states directory
      const fileName = name.endsWith('.json') ? name : `${name}.json`;
      outPath = path.join(os.homedir(), '.cssprobe-cli', 'states', fileName);
    } else if (!outPath) {
      outPath = path.join(os.homedir(), '.cssprobe-cli', 'states', 'imported.json');
    }
    
    const mergePath = parsed.merge as string | undefined;

    let content: string;
    if (filePath) {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        output.error(`File not found: ${resolved}`);
        return;
      }
      content = fs.readFileSync(resolved, 'utf-8');
    } else {
      content = '';
      for await (const chunk of process.stdin) {
        content += chunk;
      }
    }

    if (!content.trim()) {
      output.error('No cookie data provided. Provide a file path or pipe data to stdin.');
      return;
    }

    const newCookies = parseNetscapeCookies(content);
    if (newCookies.length === 0) {
      output.error('No valid cookies found. Expected Netscape format (tab-separated: domain\\tflag\\tpath\\tsecure\\texpires\\tname\\tvalue)');
      return;
    }

    let state: PlaywrightState;
    if (mergePath && fs.existsSync(mergePath)) {
      state = JSON.parse(fs.readFileSync(mergePath, 'utf-8'));
      console.error(`Merging into existing state: ${mergePath} (${state.cookies.length} cookies)`);
    } else {
      state = { cookies: [], origins: [] };
    }

    const keyed: Record<string, PlaywrightCookie> = {};
    for (const c of state.cookies) {
      keyed[`${c.domain}|${c.name}|${c.path}`] = c;
    }
    for (const nc of newCookies) {
      keyed[`${nc.domain}|${nc.name}|${nc.path}`] = nc;
    }
    state.cookies = Object.values(keyed);

    const resolvedOut = path.resolve(outPath);
    const dir = path.dirname(resolvedOut);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolvedOut, JSON.stringify(state, null, 2) + '\n');

    console.log(output.format({
      saved: resolvedOut,
      cookies: state.cookies.length,
      imported: newCookies.length,
      usage: `cssprobe-cli inspect <url> <selector> --state ${resolvedOut}`,
    }));
  } catch (e: any) {
    output.error(e instanceof Error ? e.message : String(e));
  }
}

// ── state-save ──

async function handleStateSave(
  command: AnyCommandSchema,
  args: MinimistArgs,
  output: Output
) {
  try {
    const session = await loadSession();
    if (!session) {
      output.error('No active session. Run: cssprobe-cli open <url>');
      return;
    }

    const cmdArgs = splitArgs(args);
    const parsed = parseCommand(command, cmdArgs as Record<string, string> & { _: string[] });

    const name = (parsed.name as string) || 'session';
    const fileName = name.endsWith('.json') ? name : `${name}.json`;
    const outPath = path.join(os.homedir(), '.cssprobe-cli', 'states', fileName);

    // Ask daemon to save state
    const result = await session.run({ _: ['state-save'] });
    const state = JSON.parse(result.text);

    const resolvedOut = path.resolve(outPath);
    const dir = path.dirname(resolvedOut);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolvedOut, JSON.stringify(state, null, 2) + '\n');

    if (output.json) {
      console.log(JSON.stringify({
        saved: resolvedOut,
        cookies: state.cookies?.length || 0,
        origins: state.origins?.length || 0,
        usage: `cssprobe-cli open <url> --state ${resolvedOut}`,
      }, null, 2));
    } else {
      console.log(`State saved: ${resolvedOut}`);
      console.log(`Cookies: ${state.cookies?.length || 0}`);
      console.log(`Origins: ${state.origins?.length || 0}`);
      console.log(`Usage: cssprobe-cli open <url> --state ${resolvedOut}`);
    }
  } catch (e: any) {
    output.error(e instanceof Error ? e.message : String(e));
  }
}
