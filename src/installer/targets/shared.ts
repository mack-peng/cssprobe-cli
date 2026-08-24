import * as fs from 'fs';
import * as path from 'path';
import { buildSkillMd, buildPitfallsMd } from '../skill-template';

const SKILL_NAME = 'cssprobe-cli';

export function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = filePath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

export function writeSkill(skillDir: string): { path: string; action: 'created' | 'updated' | 'unchanged' } {
  const skillRoot = path.join(skillDir, SKILL_NAME);
  const skillMdPath = path.join(skillRoot, 'SKILL.md');
  const refsDir = path.join(skillRoot, 'references');
  const pitfallsPath = path.join(refsDir, 'pitfalls.md');

  const skillMdContent = buildSkillMd();
  const pitfallsContent = buildPitfallsMd();

  const existingSkill = safeRead(skillMdPath);
  const existingPitfalls = safeRead(pitfallsPath);

  if (existingSkill === skillMdContent && existingPitfalls === pitfallsContent)
    return { path: skillRoot, action: 'unchanged' };

  const existed = fs.existsSync(skillMdPath);
  if (!fs.existsSync(refsDir)) fs.mkdirSync(refsDir, { recursive: true });
  atomicWriteFileSync(skillMdPath, skillMdContent);
  atomicWriteFileSync(pitfallsPath, pitfallsContent);
  return { path: skillRoot, action: existed ? 'updated' : 'created' };
}

export function removeSkill(skillDir: string): { path: string; action: 'removed' | 'not-found' | 'kept' } {
  const skillRoot = path.join(skillDir, SKILL_NAME);
  const skillMdPath = path.join(skillRoot, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) return { path: skillRoot, action: 'kept' };

  rmRf(skillRoot);
  return { path: skillRoot, action: fs.existsSync(skillMdPath) ? 'not-found' : 'removed' };
}

function rmRf(dir: string) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) rmRf(full);
    else try { fs.unlinkSync(full); } catch { /* ignore */ }
  }
  try { fs.rmdirSync(dir); } catch { /* ignore */ }
}

function safeRead(filePath: string): string | null {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
}
