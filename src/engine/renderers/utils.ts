import type { TreeNode, Confidence } from '../types';

export function nodeLabel(node: TreeNode): string {
  const cls = node.classes.length ? `.${node.classes.join('.')}` : '';
  const id = node.id ? `#${node.id}` : '';
  return `${node.tag}${id}${cls}`;
}

export function smartLabel(node: TreeNode, maxLen: number): string {
  const full = nodeLabel(node);
  if (full.length <= maxLen) return full;

  const id = node.id ? `#${node.id}` : '';
  const firstCls = node.classes.length > 0 ? `.${node.classes[0]}` : '';
  const short = `${node.tag}${id}${firstCls}`;
  if (short.length <= maxLen) return short;

  const tagId = `${node.tag}${id}`;
  if (tagId.length <= maxLen) return tagId;

  if (node.tag.length <= maxLen) return node.tag;

  return node.tag.slice(0, Math.max(maxLen - 3, 1)) + '...';
}

export function isMultiColumn(node: TreeNode): boolean {
  const display = node.props.display;
  return (
    node.shape?.role === 'flex-row' ||
    (display === 'flex' && node.props.flexDirection !== 'column') ||
    display === 'grid' ||
    display === 'inline-grid'
  );
}

export const BOX = { tl: '\u250C', tr: '\u2510', bl: '\u2514', br: '\u2518', h: '\u2500', v: '\u2502' } as const;

export const CONF_BADGE: Record<Confidence, string> = {
  DEFINITE: 'DEFINITE',
  INDEFINITE: 'INDEFINITE',
  UNVERIFIABLE: 'UNVERIFIABLE',
};

export function confidenceSummary(findings: { confidence: Confidence }[]): string {
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
