// Renderer — pure functions: Snapshot + Finding[] → Markdown or JSON.
// No browser or filesystem access.

import type { Snapshot, Finding } from './types';
import { confidenceSummary } from './renderers/utils';
import { renderNode } from './renderers/dom-tree';
import { renderAncestors } from './renderers/ancestors';
import { renderSketch } from './renderers/sketch';
import { renderLayout } from './renderers/layout';
import { renderFindings, renderBriefFindings } from './renderers/findings';

// ─── Markdown ───

export function renderMarkdown(snapshot: Snapshot, findings: Finding[], brief = false, layout = false): string {
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

  if (layout) {
    lines.push('');
    lines.push(...renderLayout(snapshot, findings));
  }

  if (brief) {
    lines.push('');
    lines.push('## Tree Sketch (issues only)');
    lines.push('```');
    lines.push(...renderSketch(snapshot.tree, findings));
    lines.push('```');
  } else if (!layout) {
    lines.push('');
    lines.push(`## DOM tree (${snapshot.downDepth} levels deep)`);
    lines.push('```');
    lines.push(...renderNode(snapshot.tree!, 0));
    lines.push('```');
  }

  lines.push('');
  lines.push(...(brief ? renderBriefFindings(findings) : renderFindings(findings)));

  if (snapshot.crossOriginBlocked && snapshot.crossOriginBlocked > 0) {
    lines.push('');
    lines.push('## Cross-origin limitation');
    lines.push(`\u26A0 ${snapshot.crossOriginBlocked} stylesheet(s) from CDN/cross-origin were blocked by browser security (SecurityError). Declared values from these sheets are marked UNVERIFIABLE \u2014 computed styles from getComputedStyle() are still accurate.`);
    if (snapshot.blockedSheetUrls && snapshot.blockedSheetUrls.length > 0) {
      lines.push(`Blocked (from CDN/cross-origin): ${snapshot.blockedSheetUrls.join(', ')}`);
    }
  }

  return lines.join('\n');
}

// ─── JSON ───

export function renderJSON(snapshot: Snapshot, findings: Finding[], brief = false): object {
  const counts = findings.reduce((acc, f) => {
    acc[f.confidence] = (acc[f.confidence] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const meta = {
    rootSelector: snapshot.rootSelector,
    viewport: snapshot.viewport,
    nodeCount: snapshot.nodeCount,
    crossOriginBlocked: snapshot.crossOriginBlocked,
    blockedSheetUrls: snapshot.blockedSheetUrls,
  };

  if (brief) {
    const important = findings.filter(f => f.level === 'warning' || f.level === 'error');
    const briefFindings = important.map(f => ({
      id: f.id,
      level: f.level,
      message: f.message,
      confidence: f.confidence,
      location: f.location,
      evidence: f.evidence.slice(0, 1),
    }));
    return {
      meta,
      snapshot: { rootSelector: snapshot.rootSelector, nodeCount: snapshot.nodeCount, downDepth: snapshot.downDepth },
      findings: briefFindings,
      summary: {
        total: findings.length,
        warnings: important.filter(f => f.level === 'warning').length,
        errors: important.filter(f => f.level === 'error').length,
        confidence: { DEFINITE: counts.DEFINITE || 0, INDEFINITE: counts.INDEFINITE || 0, UNVERIFIABLE: counts.UNVERIFIABLE || 0 },
      },
    };
  }

  return {
    meta,
    snapshot: snapshot.error ? { error: snapshot.error, candidates: snapshot.candidates } : snapshot,
    findings,
    summary: {
      total: findings.length,
      confidence: { DEFINITE: counts.DEFINITE || 0, INDEFINITE: counts.INDEFINITE || 0, UNVERIFIABLE: counts.UNVERIFIABLE || 0 },
    },
  };
}
