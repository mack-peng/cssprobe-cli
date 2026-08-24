// Renderer — pure functions: Snapshot + Finding[] → Markdown or JSON.
// No browser or filesystem access.

import type { Snapshot, TreeNode, AncestorNode, Finding, Confidence } from './types';

// ─── Node rendering (DOM tree) ───

function renderNode(node: TreeNode, indent: number): string[] {
  const lines: string[] = [];
  if (!node) return lines;
  const cls = node.classes.length ? `.${node.classes.join('.')}` : '';
  const id = node.id ? `#${node.id}` : '';
  const repeat = node.repeat ? ` \u00D7${node.repeat}` : '';
  const m = node.metrics;
  const s = node.shape || {};
  const flag: string[] = [];
  if (node.flags.overflowsViewport) flag.push('\u26A0viewport-overflow');
  if (node.flags.overflowsParent) flag.push('\u26A0parent-overflow');
  if (m.clientHeight === 0 && m.offsetHeight === 0) flag.push('\u26A0collapsed(0px)');
  if (node.flags.scrollable) flag.push('\u2714scrollable');
  if (node.flags.hasScrollY && !node.flags.scrollable) {
    flag.push(`\u26A0overflow(${m.scrollHeight}>${m.clientHeight})but-overflow=${node.props.overflowY}`);
  }
  if (node.containingBlockModifiers.length) {
    flag.push(`CB:${node.containingBlockModifiers.join(' ')}`);
  }
  const styleHint = node.inlineStyle ? ` style="${node.inlineStyle}"` : '';
  const h = node.props.height;
  const heightStr = h === 'auto' ? `auto\u2192${m.offsetHeight}px` : `${h}`;
  const w = node.props.width;
  const widthStr = w === 'auto' ? `auto\u2192${m.clientWidth}px` : `${w}`;
  const mhStr = node.declared && node.declared['max-height'] ? ` maxH:${node.declared['max-height'].map(x => x.value).join(';')}` : '';
  const shapeStr = s.role ? `[${s.role}${s.scrollTag ? ' ' + s.scrollTag : ''} h:${s.heightStrategy} w:${s.widthStrategy}]` : '';

  lines.push(
    `${'  '.repeat(indent)}<${node.tag}${id}${cls}${styleHint}${repeat}> ${shapeStr} [${node.props.position},${node.props.display},h:${heightStr},w:${widthStr}${mhStr}] rect(${m.rect.width}\u00D7${m.rect.height}) bottom=${m.rectBottom} scroll=${m.clientHeight}/${m.scrollHeight}` +
    (flag.length ? ` ${flag.join(' ')}` : '') +
    (node.text ? ` \u300C${node.text.slice(0, 30)}\u300D` : '')
  );
  for (const child of node.children) {
    lines.push(...renderNode(child, indent + 1));
  }
  return lines;
}

function renderAncestors(chain: AncestorNode[]): string[] {
  return chain.map(a => {
    const dh = a.declared && a.declared.height ? a.declared.height.map(x => `${x.selector}\u2192${x.value}`).join('; ') : 'auto';
    const dw = a.declared && a.declared.width ? a.declared.width.map(x => `${x.selector}\u2192${x.value}`).join('; ') : 'auto';
    const mh = a.declared && a.declared['max-height'] ? a.declared['max-height'].map(x => `${x.selector}\u2192${x.value}`).join('; ') : null;
    const maxPart = mh ? ` max-height:${mh}` : '';
    const s = a.shape || {};
    const shapeStr = s.role ? `[${s.role}${s.scrollTag ? ' ' + s.scrollTag : ''} h:${s.heightStrategy} w:${s.widthStrategy}]` : '';
    return `${a.label} ${shapeStr} [${a.props.position},${a.props.display}] h:${dh}${maxPart} w:${dw} \u2192 ${a.metrics.clientWidth}\u00D7${a.metrics.offsetHeight}` +
      (a.containingBlockModifiers.length ? ` CB:${a.containingBlockModifiers.join(' ')}` : '') +
      (a.inlineStyle ? ` style="${a.inlineStyle}"` : '');
  });
}

// ─── Findings rendering ───

const CONF_BADGE: Record<Confidence, string> = {
  DEFINITE: 'DEFINITE',
  INDEFINITE: 'INDEFINITE',
  UNVERIFIABLE: 'UNVERIFIABLE',
};

function renderFindings(findings: Finding[]): string[] {
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

function confidenceSummary(findings: Finding[]): string {
  const counts = findings.reduce((acc, f) => {
    acc[f.confidence] = (acc[f.confidence] || 0) + 1;
    return acc;
  }, {} as Record<Confidence, number>);
  const parts = [
    `DEFINITE ${counts.DEFINITE || 0}`,
    `INDEFINITE ${counts.INDEFINITE || 0}`,
    `UNVERIFIABLE ${counts.UNVERIFIABLE || 0}`,
  ];
  return parts.join(' | ');
}

// ─── Markdown ───

export function renderMarkdown(snapshot: Snapshot, findings: Finding[]): string {
  const lines: string[] = [];
  const vp = snapshot.viewport ? `${snapshot.viewport.width}\u00D7${snapshot.viewport.height}` : 'unknown';
  lines.push('# cssprobe-cli report');
  lines.push(`viewport: ${vp} | root: ${snapshot.rootSelector} | nodes: ${snapshot.nodeCount}`);
  lines.push(`confidence: ${confidenceSummary(findings)}`);

  if (snapshot.error) {
    lines.push('');
    lines.push(`\u26A0 ${snapshot.error}`);
    if (snapshot.candidates && snapshot.candidates.length) {
      lines.push(`Similar nodes: ${snapshot.candidates.join(', ')}`);
    }
    return lines.join('\n');
  }

  lines.push('');
  lines.push(`## Ancestor chain (root\u2192${snapshot.upTo})`);
  lines.push('```');
  lines.push(...renderAncestors(snapshot.ancestors));
  lines.push('```');

  lines.push('');
  lines.push(`## DOM tree (${snapshot.downDepth} levels deep)`);
  lines.push('```');
  lines.push(...renderNode(snapshot.tree!, 0));
  lines.push('```');

  lines.push('');
  lines.push(...renderFindings(findings));

  if (snapshot.crossOriginBlocked && snapshot.crossOriginBlocked > 0) {
    lines.push('');
    lines.push('## Cross-origin limitation');
    lines.push(`\u26A0 ${snapshot.crossOriginBlocked} stylesheet(s) blocked by browser security (SecurityError). Declared values from these sheets are marked UNVERIFIABLE \u2014 computed values from getComputedStyle() are still accurate.`);
    if (snapshot.blockedSheetUrls && snapshot.blockedSheetUrls.length > 0) {
      lines.push(`Blocked: ${snapshot.blockedSheetUrls.join(', ')}`);
    }
  }

  return lines.join('\n');
}

// ─── JSON ───

export function renderJSON(snapshot: Snapshot, findings: Finding[]): object {
  const counts = findings.reduce((acc, f) => {
    acc[f.confidence] = (acc[f.confidence] || 0) + 1;
    return acc;
  }, {} as Record<Confidence, number>);
  return {
    meta: {
      rootSelector: snapshot.rootSelector,
      viewport: snapshot.viewport,
      nodeCount: snapshot.nodeCount,
      crossOriginBlocked: snapshot.crossOriginBlocked,
      blockedSheetUrls: snapshot.blockedSheetUrls,
    },
    snapshot: snapshot.error ? { error: snapshot.error, candidates: snapshot.candidates } : snapshot,
    findings,
    summary: {
      total: findings.length,
      confidence: { DEFINITE: counts.DEFINITE || 0, INDEFINITE: counts.INDEFINITE || 0, UNVERIFIABLE: counts.UNVERIFIABLE || 0 },
    },
  };
}
