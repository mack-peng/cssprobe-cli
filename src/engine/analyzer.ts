// Node-side analyzer. Pure functions: Snapshot → Finding[].
// No browser or filesystem access — directly unit-testable.

import type {
  Snapshot,
  TreeNode,
  AncestorNode,
  DeclaredValue,
  Confidence,
  Evidence,
  Finding,
} from './types';
import { pickWinning } from './specificity';

// ─── Confidence helpers ───

/** Pick the winning declared value for a property (inline wins, else highest specificity). */
function declaredFor(
  node: { declared: Record<string, DeclaredValue[]> },
  prop: string,
): DeclaredValue | null {
  const arr = node.declared && node.declared[prop];
  if (!arr || arr.length === 0) return null;
  return pickWinning(arr);
}

/**
 * Confidence of a declaration-backed claim:
 * - accessible inline/rule value → DEFINITE
 * - accessible value that is a % (resolves at runtime) → INDEFINITE
 * - only inaccessible (blocked sheet) or missing declaration → UNVERIFIABLE
 */
function confidenceFor(node: { declared: Record<string, DeclaredValue[]> }, props: string[]): Confidence {
  let sawAccessible = false;
  let sawPercent = false;
  for (const prop of props) {
    const d = declaredFor(node, prop);
    if (!d) continue;
    if (!d.accessible) return 'UNVERIFIABLE';
    sawAccessible = true;
    if (d.value.endsWith('%')) sawPercent = true;
  }
  if (!sawAccessible) return 'UNVERIFIABLE';
  return sawPercent ? 'INDEFINITE' : 'DEFINITE';
}

function evDeclared(d: DeclaredValue): Evidence {
  return {
    type: 'declared',
    property: 'height',
    value: d.value,
    source: `${d.selector} (${d.href || 'inline'})`,
    accessible: d.accessible,
  };
}

function evComputed(node: { props: Record<string, string | undefined> }, prop: string): Evidence {
  return {
    type: 'computed',
    property: prop,
    value: node.props[prop] ?? '',
  };
}

const ABS_UNIT = /^(0|[1-9]\d*)(\.\d+)?(px|pt|cm|mm|in|vh|vw|vmin|vmax|rem|em)$/;

function nodeLabel(n: { tag: string; classes?: string[]; id?: string | null }): string {
  const cls = (n.classes || []).join('.');
  return `${n.tag}.${cls}`;
}

function makeFinding(partial: Omit<Finding, 'evidence' | 'confidence'> & { confidence?: Confidence; evidence?: Evidence[] }): Finding {
  return {
    id: partial.id,
    level: partial.level,
    message: partial.message,
    confidence: partial.confidence ?? 'UNVERIFIABLE',
    evidence: partial.evidence ?? [],
    ...(partial.location ? { location: partial.location } : {}),
  };
}

// ─── Ancestors ───

function allAncestorsContentSized(ancestors: AncestorNode[]): boolean {
  return ancestors.length > 0 && ancestors.every(a => a.shape.heightStrategy === 'content');
}

// ─── Collect scroll/constraint candidates from tree ───

interface WalkResult {
  scrollNodes: TreeNode[];
  constraintNodes: TreeNode[];
  flexPairs: { parent: TreeNode; child: TreeNode }[];
  cbNodes: TreeNode[];
}

function walkTree(root: TreeNode | null): WalkResult {
  const scrollNodes: TreeNode[] = [];
  const constraintNodes: TreeNode[] = [];
  const flexPairs: { parent: TreeNode; child: TreeNode }[] = [];
  const cbNodes: TreeNode[] = [];

  const walk = (n: TreeNode | null, parent: TreeNode | null) => {
    if (!n) return;
    if (n.flags.hasScrollY || n.props.overflowY === 'auto' || n.props.overflowY === 'scroll') {
      scrollNodes.push(n);
    }
    const parentHealthy = parent && parent.metrics.clientHeight > 0;
    if (n.flags.overflowsParent && !(n.props.overflowY === 'auto' || n.props.overflowY === 'scroll') && parentHealthy) {
      constraintNodes.push(n);
    }
    if (parent && (parent.props.display === 'flex' || parent.props.display === 'inline-flex')) {
      flexPairs.push({ parent, child: n });
    }
    if (n.containingBlockModifiers && n.containingBlockModifiers.length > 0) {
      cbNodes.push(n);
    }
    for (const child of n.children) walk(child, n);
  };
  walk(root, null);
  if (root && root.flags.overflowsParent && !(root.props.overflowY === 'auto' || root.props.overflowY === 'scroll')) {
    constraintNodes.push(root);
  }
  return { scrollNodes, constraintNodes, flexPairs, cbNodes };
}

// ─── Analyzers ───

function analyzeAnchors(snapshot: Snapshot): Finding[] {
  const findings: Finding[] = [];
  const ancestors = snapshot.ancestors;

  const anchorInfo = ancestors.map(a => {
    const dh = declaredFor(a, 'height');
    const mh = declaredFor(a, 'max-height');
    return {
      node: a,
      heightDeclared: dh,
      maxHeightDeclared: mh,
      computedHeight: a.props.height,
      hasAbsolute: !!(dh && ABS_UNIT.test(dh.value)),
      hasPercent: !!(dh && dh.value.endsWith('%')),
    };
  });

  const anchored = anchorInfo.find(x => x.hasAbsolute);

  // Main anchor claim
  const message = anchored
    ? `chain has absolute-unit height at ${anchored.node.label}: ${anchored.heightDeclared!.value}`
    : 'all heights are % or missing → chain depends on containing block runtime resolution (may resolve to auto)';
  const anchorConf = anchored
    ? confidenceFor(anchored.node, ['height'])
    : (() => {
        const confs = anchorInfo.map(x => x.heightDeclared ? (x.heightDeclared.accessible ? (x.hasPercent ? 'INDEFINITE' : 'DEFINITE') : 'UNVERIFIABLE') : 'UNVERIFIABLE');
        return confs.includes('UNVERIFIABLE') ? 'UNVERIFIABLE' : (confs.includes('INDEFINITE') ? 'INDEFINITE' : 'DEFINITE');
      })();

  findings.push(makeFinding({
    id: anchored ? 'anchor-present' : 'anchor-missing',
    level: anchored ? 'info' : 'warning',
    message,
    confidence: anchorConf,
    evidence: anchorInfo.slice(0, 6).flatMap(x => {
      const ev: Evidence[] = [];
      if (x.heightDeclared) ev.push({ type: 'declared', property: 'height', value: x.heightDeclared.value, source: `${x.heightDeclared.selector} (${x.heightDeclared.href || 'inline'})`, accessible: x.heightDeclared.accessible });
      ev.push({ type: 'computed', property: 'height', value: x.computedHeight });
      return ev;
    }),
    location: anchored ? anchored.node.label : ancestors[ancestors.length - 1]?.label,
  }));

  // max-height-only cap note
  const maxOnly = anchorInfo.filter(x => !x.heightDeclared && x.maxHeightDeclared);
  if (maxOnly.length) {
    const evs = maxOnly.slice(0, 3).flatMap(x => x.maxHeightDeclared ? [evDeclared(x.maxHeightDeclared)] : []);
    findings.push(makeFinding({
      id: 'max-height-only',
      level: 'warning',
      message: `these nodes only declare max-height (cap, not anchor) → % children still resolve to auto: ${maxOnly.map(x => x.node.label).join(', ')}`,
      confidence: 'DEFINITE',
      evidence: evs,
      location: maxOnly[0].node.label,
    }));
  }

  return findings;
}

function analyzeScroll(snapshot: Snapshot): Finding[] {
  const findings: Finding[] = [];
  const { scrollNodes, constraintNodes } = walkTree(snapshot.tree);

  for (const n of constraintNodes.slice(0, 8)) {
    findings.push(makeFinding({
      id: 'constraint-candidate',
      level: 'warning',
      message: `${nodeLabel(n)} overflows parent but is not a scroll container → constraint candidate (flex child min-height:auto or parent height unconstrained)`,
      confidence: 'DEFINITE',
      evidence: [
        evComputed(n, 'overflowY'),
        { type: 'computed', property: 'scrollHeight', value: String(n.metrics.scrollHeight) },
        { type: 'computed', property: 'clientHeight', value: String(n.metrics.clientHeight) },
      ],
      location: nodeLabel(n),
    }));
  }

  for (const n of scrollNodes) {
    const isScrollDeclared = n.props.overflowY === 'auto' || n.props.overflowY === 'scroll';
    // Computed overflow-y is a fact from getComputedStyle — always DEFINITE
    const conf: Confidence = 'DEFINITE';

    let id: string;
    let message: string;
    let level: 'info' | 'warning' | 'error';
    if (n.metrics.clientHeight === 0) {
      id = 'scroll-collapsed';
      message = `${nodeLabel(n)} height collapsed to 0 → overflow-y:${n.props.overflowY} has no viewport → height chain unconstrained (anchor issue)`;
      level = 'error';
    } else if (n.flags.scrollable) {
      id = 'scrollable';
      message = `${nodeLabel(n)} scrollable (scrollHeight ${n.metrics.scrollHeight} > clientHeight ${n.metrics.clientHeight})`;
      level = 'info';
    } else if (!n.flags.hasScrollY && isScrollDeclared && Math.abs(n.metrics.offsetHeight - n.metrics.scrollHeight) <= 1) {
      id = 'scroll-content-sized';
      message = `${nodeLabel(n)} content-sized (${n.metrics.offsetHeight}px, scrollHeight==clientHeight) → overflow-y:auto never triggers → height chain unconstrained (anchor issue)`;
      level = 'warning';
    } else if (!n.flags.hasScrollY) {
      id = 'no-overflow';
      message = `${nodeLabel(n)} no overflow, no scroll needed`;
      level = 'info';
    } else if (n.props.overflowY === 'visible') {
      id = 'overflow-visible';
      message = `${nodeLabel(n)} content visually overflows (${n.metrics.scrollHeight}>${n.metrics.clientHeight}) but overflow=visible means content is NOT clipped`;
      level = 'info';
    } else {
      id = 'overflow-clipped';
      message = `${nodeLabel(n)} content overflows (${n.metrics.scrollHeight}>${n.metrics.clientHeight}) clipped by overflow=${n.props.overflowY}`;
      level = 'warning';
    }

    findings.push(makeFinding({
      id,
      level,
      message,
      confidence: conf,
      evidence: [
        evComputed(n, 'overflowY'),
        { type: 'computed', property: 'scrollHeight', value: String(n.metrics.scrollHeight) },
        { type: 'computed', property: 'clientHeight', value: String(n.metrics.clientHeight) },
      ],
      location: nodeLabel(n),
    }));
  }

  return findings;
}

function analyzeFlex(snapshot: Snapshot): Finding[] {
  const findings: Finding[] = [];
  const { flexPairs } = walkTree(snapshot.tree);

  if (flexPairs.length === 0) {
    findings.push(makeFinding({
      id: 'no-flex',
      level: 'info',
      message: 'no flex parent-child relationships found in the tree',
      confidence: 'DEFINITE',
    }));
    return findings;
  }

  for (const { parent, child } of flexPairs.slice(0, 10)) {
    const pLabel = nodeLabel(parent);
    const cLabel = nodeLabel(child);
    const pDir = parent.props.flexDirection || 'row';
    const cMinH = child.props.minHeight;
    const cMinW = child.props.minWidth;
    const cFlexGrow = child.props.flexGrow;
    const cFlexShrink = child.props.flexShrink;

    if (pDir === 'column') {
      if ((cMinH === 'auto' || cMinH === '0px') && child.metrics.scrollHeight > child.metrics.clientHeight + 1) {
        findings.push(makeFinding({
          id: 'flex-col-overflow',
          level: 'warning',
          message: `${cLabel} is flex-col child with min-height:${cMinH} → content (${child.metrics.scrollHeight}px) may overflow parent (${parent.metrics.clientHeight}px)`,
          confidence: 'DEFINITE',
          evidence: [
            evComputed(parent, 'display'),
            evComputed(parent, 'flexDirection'),
            evComputed(child, 'minHeight'),
            { type: 'computed', property: 'scrollHeight', value: String(child.metrics.scrollHeight) },
            { type: 'computed', property: 'clientHeight', value: String(child.metrics.clientHeight) },
          ],
          location: cLabel,
        }));
      }
      if (cFlexGrow === '0' && cFlexShrink === '0' && cMinH === 'auto') {
        findings.push(makeFinding({
          id: 'flex-zero-auto',
          level: 'info',
          message: `${cLabel}: flex:0 0 auto in ${pLabel}(column) → height is content-driven, not constrained by flex`,
          confidence: 'DEFINITE',
          evidence: [evComputed(child, 'flexGrow'), evComputed(child, 'flexShrink'), evComputed(child, 'minHeight')],
          location: cLabel,
        }));
      }
    } else {
      if ((cMinW === 'auto' || cMinW === '0px') && child.metrics.scrollWidth > child.metrics.clientWidth + 1) {
        findings.push(makeFinding({
          id: 'flex-row-overflow',
          level: 'warning',
          message: `${cLabel} is flex-row child with min-width:${cMinW} → content (${child.metrics.scrollWidth}px) may overflow parent`,
          confidence: 'DEFINITE',
          evidence: [evComputed(parent, 'display'), evComputed(child, 'minWidth'), evComputed(child, 'overflowX')],
          location: cLabel,
        }));
      }
    }
  }

  return findings;
}

function analyzeContainingBlock(snapshot: Snapshot): Finding[] {
  const findings: Finding[] = [];
  const { cbNodes } = walkTree(snapshot.tree);
  const ancestorsWithCB = snapshot.ancestors.filter(a => a.containingBlockModifiers.length > 0);

  const allCB = [
    ...cbNodes.slice(0, 5).map(n => ({ label: nodeLabel(n), mods: n.containingBlockModifiers, node: n })),
    ...ancestorsWithCB.map(a => ({ label: a.label, mods: a.containingBlockModifiers, node: a })),
  ];

  if (allCB.length === 0) {
    findings.push(makeFinding({
      id: 'no-cb',
      level: 'info',
      message: 'no containing block modifiers found in the tree',
      confidence: 'DEFINITE',
    }));
    return findings;
  }

  const hasFixed = snapshot.ancestors.some(a => a.shape.role === 'fixed') ||
    (snapshot.tree && snapshot.tree.props.position === 'fixed');

  for (const cb of allCB.slice(0, 5)) {
    const isRootFixed = cb.node.props.position === 'fixed';
    findings.push(makeFinding({
      id: 'cb-modifier',
      level: isRootFixed ? 'error' : 'info',
      message: `${cb.label}: CB modifiers: ${cb.mods.join(', ')}${isRootFixed ? ' → fixed/absolute descendants resolve % against this ancestor (containing block hijack)' : ''}`,
      confidence: 'DEFINITE',
      evidence: cb.mods.map(m => ({ type: 'declared', property: m.split(':')[0].trim(), value: m.split(':').slice(1).join(':').trim(), accessible: true })),
      location: cb.label,
    }));
  }

  if (hasFixed && snapshot.ancestors.every(a => a.shape.heightStrategy === 'content')) {
    findings.push(makeFinding({
      id: 'fixed-no-anchor',
      level: 'error',
      message: 'fixed ancestor + no height anchor → children % resolve to auto → content-sized overflow',
      confidence: 'DEFINITE',
    }));
  }

  return findings;
}

function detectPatterns(snapshot: Snapshot): Finding[] {
  const findings: Finding[] = [];
  const ancestors = snapshot.ancestors;
  const { scrollNodes } = walkTree(snapshot.tree);
  const anchored = ancestors.some(a => {
    const dh = declaredFor(a, 'height');
    return !!(dh && ABS_UNIT.test(dh.value));
  });

  const hasFlexCol = ancestors.some(a => a.shape.role === 'flex-col');
  const hasFixed = ancestors.some(a => a.shape.role === 'fixed');
  const scrollableExists = scrollNodes.some(n => n.flags.scrollable);

  if (hasFixed && !anchored) {
    findings.push(makeFinding({
      id: 'pattern-fixed-no-anchor',
      level: 'info',
      message: 'Pattern: fixed ancestor + no height anchor → children % resolve to auto → content-sized overflow',
      confidence: 'DEFINITE',
    }));
  }
  if (hasFlexCol) {
    const fc = ancestors.find(a => a.shape.role === 'flex-col');
    findings.push(makeFinding({
      id: 'pattern-flex-col',
      level: 'info',
      message: `Pattern: flex-col at ${fc!.label} → children height governed by flex-grow/shrink/min-height`,
      confidence: 'DEFINITE',
    }));
  }
  if (scrollableExists && !anchored) {
    findings.push(makeFinding({
      id: 'pattern-scroll-no-anchor',
      level: 'info',
      message: 'Pattern: scroll container exists but no height anchor above → overflow:auto never triggers (content-sized)',
      confidence: 'DEFINITE',
    }));
  }
  if (allAncestorsContentSized(ancestors)) {
    findings.push(makeFinding({
      id: 'pattern-content-sized',
      level: 'info',
      message: 'Pattern: all ancestors are content-sized → height entirely depends on content, no constraints propagate',
      confidence: 'DEFINITE',
    }));
  }
  return findings;
}

// ─── Public entry ───

export function analyze(snapshot: Snapshot): Finding[] {
  const findings: Finding[] = [
    ...analyzeAnchors(snapshot),
    ...analyzeScroll(snapshot),
    ...analyzeFlex(snapshot),
    ...analyzeContainingBlock(snapshot),
    ...detectPatterns(snapshot),
  ];
  return findings;
}
