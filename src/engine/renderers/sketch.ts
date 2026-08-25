import type { TreeNode, Finding } from '../types';
import { nodeLabel } from './utils';

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

export function renderSketch(tree: TreeNode | null, findings: Finding[]): string[] {
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
