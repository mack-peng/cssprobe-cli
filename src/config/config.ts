import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { MinimistArgs } from '../cli/minimist';

export interface ProfileConfig {
  browser?: string;
  depth?: string;
  headed?: string;
}

interface RcFile {
  active: string;
  profiles: Record<string, ProfileConfig>;
}

export interface Config {
  browser: string;
  depth: number;
  headed: boolean;
  output: 'text' | 'json';
  raw: boolean;
}

export const rcFilePath = path.join(os.homedir(), '.cssprobe-clirc');

let cachedRc: { rc: RcFile; mtime: number } | null = null;

function readRcFile(): RcFile {
  try {
    const stat = fs.statSync(rcFilePath);
    if (cachedRc && cachedRc.mtime === stat.mtimeMs)
      return cachedRc.rc;
    const content = fs.readFileSync(rcFilePath, 'utf-8');
    const rc = JSON.parse(content);
    cachedRc = { rc, mtime: stat.mtimeMs };
    return rc;
  } catch {
    return { active: 'default', profiles: {} };
  }
}

function writeRcFile(rc: RcFile): void {
  fs.writeFileSync(rcFilePath, JSON.stringify(rc, null, 2) + '\n');
  cachedRc = null;
}

function resolveProfileName(args: MinimistArgs): string {
  const fromArgs = (args.p as string) || (args.profile as string);
  const fromEnv = process.env.CSSPROBE_PROFILE;
  if (fromArgs) return fromArgs;
  if (fromEnv) return fromEnv;
  return readRcFile().active;
}

function resolveProfile(args: MinimistArgs): ProfileConfig {
  const name = resolveProfileName(args);
  const rc = readRcFile();
  return rc.profiles[name] || {};
}

export function loadConfig(args: MinimistArgs): Config {
  const profile = resolveProfile(args);

  const browser = (args.browser as string) || process.env.CSSPROBE_BROWSER || profile.browser || 'chromium';
  const depthRaw = args.depth ?? process.env.CSSPROBE_DEPTH ?? profile.depth;
  const depth = depthRaw ? Number(depthRaw) : 6;
  const headed = !!(args.headed || process.env.CSSPROBE_HEADED === 'true' || profile.headed === 'true');

  return {
    browser,
    depth: Number.isNaN(depth) ? 6 : depth,
    headed,
    output: args.json ? 'json' : 'text',
    raw: !!args.raw,
  };
}

export function maskConfig(config: Config): Record<string, string> {
  return {
    browser: config.browser,
    depth: String(config.depth),
    headed: String(config.headed),
  };
}

export function writeRcConfig(key: string, value: string, profileName?: string): Record<string, string> {
  const rc = readRcFile();
  const name = profileName || rc.active;
  if (!rc.profiles[name])
    rc.profiles[name] = {};
  (rc.profiles[name] as any)[key] = value;
  writeRcFile(rc);
  return { profile: name, [key]: value };
}

export function getRcConfig(): { active: string; profiles: Record<string, ProfileConfig> } {
  const rc = readRcFile();
  return { active: rc.active, profiles: rc.profiles };
}

export function setActiveProfile(name: string): void {
  const rc = readRcFile();
  if (!rc.profiles[name])
    throw new Error(`Profile '${name}' not found`);
  rc.active = name;
  writeRcFile(rc);
}

export function createProfile(name: string): void {
  const rc = readRcFile();
  if (rc.profiles[name])
    throw new Error(`Profile '${name}' already exists`);
  rc.profiles[name] = {};
  writeRcFile(rc);
}
