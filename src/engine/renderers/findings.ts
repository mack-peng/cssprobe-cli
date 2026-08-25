import type { Finding } from '../types';
import { CONF_BADGE } from './utils';

export function renderFindings(findings: Finding[]): string[] {
  const lines: string[] = [];
  lines.push('## Findings');
  if (findings.length === 0) {
    lines.push('- 无异常发现');
    return lines;
  }
  for (const f of findings) {
    const badge = `[${CONF_BADGE[f.confidence]}]`;
    const loc = f.location ? ` @ ${f.location}` : '';
    lines.push(`- ${f.level === 'error' ? '\u26A0' : f.level === 'warning' ? '\u26A0' : '\u2714'} ${f.message} ${badge}${loc}`);
    for (const ev of f.evidence.slice(0, 3)) {
      if (ev.type === 'computed') {
        lines.push(`    - computed ${ev.property}: ${ev.value}`);
      } else if (ev.type === 'declared') {
        lines.push(`    - declared ${ev.property}: ${ev.value} (${ev.source || '?'})${ev.accessible ? '' : ' [inaccessible]'}`);
      }
    }
  }
  return lines;
}

export function renderBriefFindings(findings: Finding[]): string[] {
  const lines: string[] = [];
  lines.push('## Findings');
  const important = findings.filter(f => f.level === 'warning' || f.level === 'error');
  if (important.length === 0) {
    lines.push('- No warnings or errors');
    return lines;
  }
  for (const f of important) {
    const badge = `[${CONF_BADGE[f.confidence]}]`;
    const loc = f.location ? ` @ ${f.location}` : '';
    const icon = f.level === 'error' ? '\u26A0' : '\u26A0';
    lines.push(`- ${icon} ${f.message} ${badge}${loc}`);
  }
  return lines;
}
