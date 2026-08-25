// Renderer — pure functions: Snapshot + Finding[] → Markdown or JSON.
// No browser or filesystem access.

import type { Snapshot, TreeNode, AncestorNode, Finding, Confidence } from './types';

// ─── Node label (matches analyzer.ts nodeLabel) ───

function nodeLabel(node: TreeNode): string {
  const cls = node.classes.length ? `.${node.classes.join('.')}` : '';
  const id = node.id ? `#${node.id}` : '';
  return `${node.tag}${id}${cls}`;
}

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

// ─── Tree Sketch (ASCII structure diagram, issues only) ───

interface SketchNode {
  label: string;
  shape: string;
  flags: string[];
  children: SketchNode[];
  hasIssue: boolean;
  omitted: number;
}

function buildSketchTree(node: TreeNode | null, issueLabels: Set<string>): SketchNode | null {
  if (!node) return null;
  const label = nodeLabel(node);
  const s = node.shape || {};
  const shapeStr = s.role ? `[${s.role} h:${s.heightStrategy} w:${s.widthStrategy}]` : '';

  const flags: string[] = [];
  if (node.flags.overflowsParent) flags.push('\u26A0parent-overflow');
  if (node.flags.overflowsViewport) flags.push('\u26A0viewport-overflow');
  if (node.metrics.clientHeight === 0 && node.metrics.offsetHeight === 0) flags.push('\u26A0collapsed');
  if (node.flags.scrollable) flags.push('\u2714scrollable');
  if (node.containingBlockModifiers.length) flags.push(`CB:${node.containingBlockModifiers.join(' ')}`);

  const hasIssue = issueLabels.has(label) || flags.length > 0;

  const children: SketchNode[] = [];
  let omitted = 0;
  for (const child of node.children) {
    const sketchChild = buildSketchTree(child, issueLabels);
    if (!sketchChild) continue;
    if (sketchChild.hasIssue || hasDescendantIssue(sketchChild)) {
      children.push(sketchChild);
    } else {
      omitted++;
    }
  }

  return { label, shape: shapeStr, flags, children, hasIssue, omitted };
}

function hasDescendantIssue(node: SketchNode): boolean {
  if (node.hasIssue) return true;
  return node.children.some(c => hasDescendantIssue(c));
}

function renderSketchNode(node: SketchNode, prefix: string, isLast: boolean): string[] {
  const lines: string[] = [];
  const connector = isLast ? '\u2514\u2500 ' : '\u251C\u2500 ';
  const flagStr = node.flags.length ? ` ${node.flags.join(' ')}` : '';
  const issueMark = node.hasIssue && node.flags.length === 0 ? ' \u26A0' : '';
  lines.push(`${prefix}${connector}${node.label} ${node.shape}${flagStr}${issueMark}`);

  const childPrefix = prefix + (isLast ? '   ' : '\u2502  ');
  const totalChildren = node.children.length + (node.omitted > 0 ? 1 : 0);

  for (let i = 0; i < node.children.length; i++) {
    lines.push(...renderSketchNode(node.children[i], childPrefix, i === totalChildren - 1));
  }

  if (node.omitted > 0) {
    const omConnector = '\u2514\u2500 ';
    lines.push(`${childPrefix}${omConnector}... (${node.omitted} subtrees omitted)`);
  }

  return lines;
}

function renderSketch(tree: TreeNode | null, findings: Finding[]): string[] {
  if (!tree) return ['(empty tree)'];

  const issueLabels = new Set<string>();
  for (const f of findings) {
    if (f.level === 'warning' || f.level === 'error') {
      if (f.location) issueLabels.add(f.location);
    }
  }

  const sketchRoot = buildSketchTree(tree, issueLabels);
  if (!sketchRoot) return ['(empty tree)'];

  if (!hasDescendantIssue(sketchRoot) && !sketchRoot.hasIssue) {
    return [`${sketchRoot.label} ${sketchRoot.shape} (no issues found in tree)`];
  }

  return renderSketchNode(sketchRoot, '', true);
}

// ─── Layout diagram (ASCII box layout) ───

const BOX = { tl: '\u250C', tr: '\u2510', bl: '\u2514', br: '\u2518', h: '\u2500', v: '\u2502' } as const;

function isFlexRow(node: TreeNode): boolean {
  return node.shape?.role === 'flex-row' || (node.props.display === 'flex' && node.props.flexDirection !== 'column');
}

function renderLayout(snapshot: Snapshot, findings: Finding[]): string[] {
  if (!snapshot.tree) return ['(empty tree)'];

  const vpW = snapshot.viewport.width;
  const termWidth = Math.min(Math.max(process.stdout?.columns || 80, 60), 120);
  const indentUnit = 2;
  const maxDepth = 8;
  const boxPad = 4;

  const issueLocations = new Set<string>();
  for (const f of findings) {
    if (f.location && (f.level === 'warning' || f.level === 'error')) issueLocations.add(f.location);
  }

  function boxCharW(nodeW: number, depth: number): number {
    const usedIndent = depth * indentUnit;
    const available = termWidth - usedIndent - boxPad;
    const ratio = nodeW / vpW;
    return Math.max(Math.round(available * ratio), 14);
  }

  const lines: string[] = [];

  function renderBox(node: TreeNode, charW: number, depth: number, flat = false): string[] {
    const m = node.metrics.rect;
    const label = nodeLabel(node);
    const hasIssue = issueLocations.has(label);
    const dimStr = `${Math.round(m.width)}\u00D7${Math.round(m.height)}`;
    const innerW = charW - 2;
    const issueMark = hasIssue ? ' \u26A0' : '';
    const boxLines: string[] = [];

    if (innerW < 3) {
      boxLines.push(`${BOX.v} ${label.slice(0, charW - 3)}... ${dimStr}`);
      return boxLines;
    }

    const labelPart = ` ${label} `;
    const dimPart = ` ${dimStr} `;
    const topFillLen = Math.max(0, innerW - labelPart.length);
    boxLines.push(`${BOX.tl}${BOX.h}${labelPart}${BOX.h.repeat(topFillLen)}${BOX.tr}${dimPart}${issueMark}`);

    // Children
    const children = node.children.filter(c => !(c.metrics.rect.width < 1 && c.metrics.rect.height < 1));
    if (children.length === 0) {
      boxLines.push(`${BOX.v}${' '.repeat(innerW)}${BOX.v}`);
    } else if (flat) {
      // Flat mode: show children as simple list (no nested boxes)
      for (const child of children) {
        const childLabel = nodeLabel(child);
        const childDim = `${Math.round(child.metrics.rect.width)}\u00D7${Math.round(child.metrics.rect.height)}`;
        const childLine = ` ${childLabel} ${childDim} `;
        if (childLine.length <= innerW) {
          boxLines.push(`${BOX.v}${childLine}${' '.repeat(innerW - childLine.length)}${BOX.v}`);
        } else {
          boxLines.push(`${BOX.v}${childLine.slice(0, innerW)}${BOX.v}`);
        }
      }
    } else if (isFlexRow(node) && children.length > 1) {
      // Flex-row: render children side-by-side
      const childLines = renderFlexChildren(children, innerW, depth + 1, m.width);
      for (const cl of childLines) {
        boxLines.push(`${BOX.v}${cl}${BOX.v}`);
      }
    } else {
      // Normal: render children nested
      for (const child of children) {
        const childBox = renderBox(child, Math.min(boxCharW(child.metrics.rect.width, depth + 1), innerW - 2), depth + 1);
        for (const cl of childBox) {
          const line = ` ${cl}`;
          if (line.length <= innerW + 1) {
            boxLines.push(`${BOX.v}${line}${' '.repeat(Math.max(0, innerW - line.length + 1))}${BOX.v}`);
          } else {
            boxLines.push(`${BOX.v}${line.slice(0, innerW)}${BOX.v}`);
          }
        }
      }
    }

    boxLines.push(`${BOX.bl}${BOX.h.repeat(innerW)}${BOX.br}`);
    return boxLines;
  }

  function renderFlexChildren(children: TreeNode[], availW: number, depth: number, parentPxW: number): string[] {
    const gap = 1;
    const totalGaps = (children.length - 1) * gap;
    const usableW = availW - totalGaps;
    const childWidths: number[] = [];
    let totalUsed = 0;
    for (let i = 0; i < children.length; i++) {
      const ratio = children[i].metrics.rect.width / parentPxW;
      const w = Math.max(Math.round(usableW * ratio), 8);
      childWidths.push(w);
      totalUsed += w;
    }
    if (childWidths.length > 0) {
      childWidths[childWidths.length - 1] += usableW - totalUsed;
    }

    // Render each child's box in flat mode (no nested expansion)
    const childBoxes: string[][] = [];
    let maxLines = 0;
    for (let i = 0; i < children.length; i++) {
      const box = renderBox(children[i], childWidths[i], depth, true);
      childBoxes.push(box);
      if (box.length > maxLines) maxLines = box.length;
    }

    // Pad all boxes to same height and merge side-by-side with gaps
    const result: string[] = [];
    for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
      let merged = '';
      for (let i = 0; i < childBoxes.length; i++) {
        const w = childWidths[i];
        if (i > 0) merged += ' ';
        if (lineIdx < childBoxes[i].length) {
          const line = childBoxes[i][lineIdx];
          if (line.length < w) {
            merged += line + ' '.repeat(w - line.length);
          } else {
            merged += line.slice(0, w);
          }
        } else {
          merged += ' '.repeat(w);
        }
      }
      result.push(merged);
    }

    return result;
  }

  function renderEl(node: TreeNode, depth: number, parentW: number): void {
    if (depth > maxDepth) {
      lines.push('  '.repeat(depth) + '... (depth limit)');
      return;
    }

    const m = node.metrics.rect;
    if (m.width < 1 && m.height < 1 && node.children.length > 0) {
      for (const child of node.children) renderEl(child, depth, parentW);
      return;
    }
    if (m.width < 1 && m.height < 1) return;

    const charW = boxCharW(m.width, depth);
    const indent = '  '.repeat(depth);
    const box = renderBox(node, charW, depth);
    for (const line of box) {
      lines.push(`${indent}${line}`);
    }
  }

  renderEl(snapshot.tree, 0, vpW);

  const scaleStr = `${Math.round(vpW / termWidth)}px/char`;
  const result: string[] = [];
  result.push(`## Layout (${vpW}\u00D7${snapshot.viewport.height} viewport, scale: ${scaleStr})`);
  result.push('```');
  result.push(...lines);
  result.push('```');
  return result;
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

function renderBriefFindings(findings: Finding[]): string[] {
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
    lines.push(`\u26A0 ${snapshot.crossOriginBlocked} stylesheet(s) blocked by browser security (SecurityError). Declared values from these sheets are marked UNVERIFIABLE \u2014 computed values from getComputedStyle() are still accurate.`);
    if (snapshot.blockedSheetUrls && snapshot.blockedSheetUrls.length > 0) {
      lines.push(`Blocked: ${snapshot.blockedSheetUrls.join(', ')}`);
    }
  }

  return lines.join('\n');
}

// ─── JSON ───

export function renderJSON(snapshot: Snapshot, findings: Finding[], brief = false): object {
  const counts = findings.reduce((acc, f) => {
    acc[f.confidence] = (acc[f.confidence] || 0) + 1;
    return acc;
  }, {} as Record<Confidence, number>);

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
