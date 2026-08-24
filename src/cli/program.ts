import fs from 'fs';
import path from 'path';
import os from 'os';
import { minimist } from './minimist';
import { parseCommand } from './command';
import { commands } from './commands';
import { TextOutput, JsonOutput } from './output';
import { loadConfig, maskConfig, writeRcConfig, getRcConfig, setActiveProfile, createProfile, rcFilePath } from '../config/config';
import { BrowserLauncher } from '../browser/launcher';
import { analyze } from '../engine/analyzer';
import { renderMarkdown, renderJSON } from '../engine/renderer';
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

  if (commandName === 'login') {
    await handleLogin(command!, cmdEntry!, rawArgs, output);
    return;
  }

  if (commandName === 'state-import') {
    await handleStateImport(command!, cmdEntry!, rawArgs, output);
    return;
  }

  await handleInspect(command!, cmdEntry!, rawArgs, output);
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

// ── inspect ──

async function handleInspect(
  command: AnyCommandSchema,
  cmdEntry: HelpEntry,
  args: MinimistArgs,
  output: Output
) {
  if (command.name !== 'inspect') {
    output.error(`Unknown command: ${command.name}`);
    return;
  }

  try {
    const cmdArgs = splitArgs(args);
    const parsed = parseCommand(command, cmdArgs as Record<string, string> & { _: string[] });
    const config = loadConfig(args);

    const url = parsed.url as string;
    const selector = parsed.selector as string | undefined;
    const zoom = !!parsed.zoom;
    const depth = (parsed.depth as number) || config.depth;
    const maxNodes = (parsed['max-nodes'] as number) || 60;
    const upTo = (parsed['up-to'] as string) || 'html';
    const headed = !!parsed.headed || config.headed;
    const browser = (parsed.browser as string) || config.browser;
    const state = (parsed.state as string) || undefined;

    if (!url) output.error('URL is required. Usage: cssprobe-cli inspect <url> [selector]');

    // Auto-detect root selector if not provided
    let rootSelector = selector;
    if (!rootSelector) {
      const detected = await autoDetectRoot(url, { browser, headed, state });
      if (!detected) {
        output.error('Could not auto-detect a root element. Please provide a selector: cssprobe-cli inspect <url> <selector>');
        return;
      }
      rootSelector = detected;
      console.error(`Auto-detected root: ${rootSelector}`);
    }

    const collectCfg: CollectConfig = {
      rootSelector,
      upTo,
      downDepth: depth,
      maxNodes,
    };

    const launcher = new BrowserLauncher({ browser, headed, state });
    await launcher.open(url);
    const snapshot = await launcher.collect(collectCfg);
    await launcher.close();

    const findings = analyze(snapshot);

    if (output.json) {
      console.log(output.format(renderJSON(snapshot, findings)));
    } else {
      console.log(renderMarkdown(snapshot, findings));
    }
  } catch (e: any) {
    output.error(e instanceof Error ? e.message : String(e));
  }
}

async function autoDetectRoot(url: string, opts: { browser: string; headed: boolean; state?: string }): Promise<string | null> {
  const launcher = new BrowserLauncher(opts);
  try {
    await launcher.open(url);
    const candidates = await launcher.autoDetectRoot();
    if (candidates.length > 0) return candidates[0];
    return null;
  } finally {
    await launcher.close();
  }
}

// ── login ──

async function handleLogin(
  command: AnyCommandSchema,
  cmdEntry: HelpEntry,
  args: MinimistArgs,
  output: Output
) {
  try {
    const cmdArgs = splitArgs(args);
    const parsed = parseCommand(command, cmdArgs as Record<string, string> & { _: string[] });
    const config = loadConfig(args);

    const url = parsed.url as string;
    const browser = (parsed.browser as string) || config.browser;
    const outPath = (parsed.out as string) || defaultStatePath(url);

    if (!url) output.error('URL is required. Usage: cssprobe-cli login <url>');

    const launcher = new BrowserLauncher({ browser, headed: true });
    const savedPath = await launcher.loginAndSave(url, outPath);
    await launcher.close();

    console.log(output.format({ saved: savedPath, usage: `cssprobe-cli inspect <url> --state ${savedPath}` }));
  } catch (e: any) {
    output.error(e instanceof Error ? e.message : String(e));
  }
}

function defaultStatePath(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/g, '_');
    const dir = path.join(os.homedir(), '.cssprobe-cli', 'states');
    return path.join(dir, `${hostname}.json`);
  } catch {
    return path.join(os.homedir(), '.cssprobe-cli', 'states', 'default.json');
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

import { resolveTargetFlag, type Location } from '../installer';

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

/**
 * Parse Netscape cookie format (tab-separated):
 * domain  flag  path  secure  expires  name  value
 *
 * Also supports lines starting with # as comments, and blank lines.
 */
function parseNetscapeCookies(content: string): PlaywrightCookie[] {
  const cookies: PlaywrightCookie[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split('\t');
    if (parts.length < 7) continue;

    const [domain, flag, path, secure, expires, name, ...valueParts] = parts;
    const value = valueParts.join('\t'); // value may contain tabs
    const expiresNum = parseInt(expires, 10);

    cookies.push({
      name,
      value,
      domain,
      path: path || '/',
      expires: isNaN(expiresNum) || expiresNum === 0 ? -1 : expiresNum,
      httpOnly: false,
      secure: secure === 'TRUE',
      sameSite: secure === 'TRUE' ? 'None' : 'Lax',
    });
  }

  return cookies;
}

async function handleStateImport(
  command: AnyCommandSchema,
  cmdEntry: HelpEntry,
  args: MinimistArgs,
  output: Output
) {
  try {
    const cmdArgs = splitArgs(args);
    const parsed = parseCommand(command, cmdArgs as Record<string, string> & { _: string[] });

    const filePath = parsed.file as string | undefined;
    const outPath = (parsed.out as string) || path.join(os.homedir(), '.cssprobe-cli', 'states', 'imported.json');
    const mergePath = parsed.merge as string | undefined;

    // Read cookie content from file or stdin
    let content: string;
    if (filePath) {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        output.error(`File not found: ${resolved}`);
        return;
      }
      content = fs.readFileSync(resolved, 'utf-8');
    } else {
      // Read from stdin
      content = '';
      for await (const chunk of process.stdin) {
        content += chunk;
      }
    }

    if (!content.trim()) {
      output.error('No cookie data provided. Provide a file path or pipe data to stdin.');
      return;
    }

    // Parse cookies
    const newCookies = parseNetscapeCookies(content);
    if (newCookies.length === 0) {
      output.error('No valid cookies found. Expected Netscape format (tab-separated: domain\\tflag\\tpath\\tsecure\\texpires\\tname\\tvalue)');
      return;
    }

    // Load existing state if merging
    let state: PlaywrightState;
    if (mergePath && fs.existsSync(mergePath)) {
      state = JSON.parse(fs.readFileSync(mergePath, 'utf-8'));
      console.error(`Merging into existing state: ${mergePath} (${state.cookies.length} cookies)`);
    } else {
      state = { cookies: [], origins: [] };
    }

    // Merge cookies (new cookies override existing ones with same domain+name+path)
    const keyed: Record<string, PlaywrightCookie> = {};
    for (const c of state.cookies) {
      keyed[`${c.domain}|${c.name}|${c.path}`] = c;
    }
    for (const nc of newCookies) {
      keyed[`${nc.domain}|${nc.name}|${nc.path}`] = nc;
    }
    state.cookies = Object.values(keyed);

    // Write output
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
