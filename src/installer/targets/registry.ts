import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { AgentTarget, Location, TargetId, WriteResult } from './types';
import { writeSkill, removeSkill } from './shared';

function makeTarget(
  id: TargetId,
  displayName: string,
  globalSkillSubdir: string,
  localSkillSubdir?: string,
): AgentTarget {
  return {
    id,
    displayName,
    skillDir(loc: Location): string | null {
      if (loc === 'global') return path.join(os.homedir(), ...globalSkillSubdir.split('/'));
      return path.join(process.cwd(), ...(localSkillSubdir || '.agents/skills').split('/'));
    },
    detect(loc: Location): { installed: boolean; alreadyConfigured: boolean } {
      const dir = this.skillDir(loc);
      if (!dir) return { installed: false, alreadyConfigured: false };
      const skillMd = path.join(dir, 'cssprobe-cli', 'SKILL.md');
      return { installed: fs.existsSync(dir), alreadyConfigured: fs.existsSync(skillMd) };
    },
    install(loc: Location): WriteResult {
      const dir = this.skillDir(loc);
      if (!dir) return { files: [] };
      return { files: [writeSkill(dir)] };
    },
    uninstall(loc: Location): WriteResult {
      const dir = this.skillDir(loc);
      if (!dir) return { files: [] };
      return { files: [removeSkill(dir)] };
    },
  };
}

const claudeTarget = makeTarget('claude', 'Claude Code', '.claude/skills', '.claude/skills');
const opencodeTarget = makeTarget('opencode', 'opencode', '.agents/skills');
const cursorTarget = makeTarget('cursor', 'Cursor', '.agents/skills');
const codexTarget = makeTarget('codex', 'Codex', '.codex/skills');
const hermesTarget = makeTarget('hermes', 'Hermes', '.hermes/skills');
const geminiTarget = makeTarget('gemini', 'Gemini', '.gemini/skills');

export const ALL_TARGETS: readonly AgentTarget[] = Object.freeze([
  claudeTarget, opencodeTarget, cursorTarget, codexTarget, hermesTarget, geminiTarget,
]);

export function getTarget(id: string): AgentTarget | undefined {
  return ALL_TARGETS.find((t) => t.id === id);
}

export function listTargetIds(): TargetId[] {
  return ALL_TARGETS.map((t) => t.id);
}

/**
 * Resolve `--target` flag to a list of AgentTarget.
 * Accepts: 'auto' (detect installed), 'all', 'none', or comma-separated ids.
 */
export function resolveTargetFlag(value: string, loc: Location): AgentTarget[] {
  if (value === 'none') return [];
  if (value === 'all') return [...ALL_TARGETS];
  if (value === 'auto') {
    const detected = ALL_TARGETS.filter((t) => t.detect(loc).installed);
    if (detected.length > 0) return detected;
    const fallback = getTarget('claude');
    return fallback ? [fallback] : [];
  }
  const ids = value.split(',').map((s) => s.trim()).filter(Boolean);
  const resolved: AgentTarget[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const t = getTarget(id);
    if (t) resolved.push(t);
    else unknown.push(id);
  }
  if (unknown.length > 0) {
    const known = listTargetIds().join(', ');
    throw new Error(`Unknown --target id(s): ${unknown.join(', ')}. Known: ${known}, plus 'auto' / 'all' / 'none'.`);
  }
  return resolved;
}
