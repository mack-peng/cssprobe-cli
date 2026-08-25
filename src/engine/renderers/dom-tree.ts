import type { TreeNode } from '../types';

export function renderNode(node: TreeNode, indent: number): string[] {
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
