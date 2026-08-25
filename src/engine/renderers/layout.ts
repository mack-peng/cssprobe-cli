import type { Snapshot, TreeNode, Finding } from '../types';
import { nodeLabel, smartLabel, isFlexRow, BOX } from './utils';

export function renderLayout(snapshot: Snapshot, findings: Finding[]): string[] {
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
    const dimStr = `${Math.round(m.width)}\u00D7${Math.round(m.height)}`;
    const innerW = Math.max(charW - 2, 1);
    const label = smartLabel(node, innerW - 4);
    const hasIssue = issueLocations.has(label);
    const issueMark = hasIssue ? ' \u26A0' : '';
    const repeat = node.repeat && node.repeat > 1 ? node.repeat : 1;
    const boxLines: string[] = [];

    if (innerW < 3) {
      boxLines.push(`${BOX.v} ${label.slice(0, Math.max(charW - 3, 0))}... ${dimStr}`);
      return boxLines;
    }

    const labelPart = ` ${label}${repeat > 1 ? ` \u00D7${repeat}` : ''} `;
    const dimPart = ` ${dimStr} `;
    const topFillLen = Math.max(0, innerW - labelPart.length - dimPart.length);
    boxLines.push(`${BOX.tl}${BOX.h}${labelPart}${BOX.h.repeat(topFillLen)}${BOX.tr}${dimPart}${issueMark}`);

    // Children
    const children = node.children.filter(c => !(c.metrics.rect.width < 1 && c.metrics.rect.height < 1));
    if (children.length === 0) {
      boxLines.push(`${BOX.v}${' '.repeat(innerW)}${BOX.v}`);
    } else if (flat) {
      for (const child of children) {
        const childLabel = nodeLabel(child);
        const childRepeat = child.repeat && child.repeat > 1 ? ` \u00D7${child.repeat}` : '';
        const childDim = `${Math.round(child.metrics.rect.width)}\u00D7${Math.round(child.metrics.rect.height)}`;
        const childLine = ` ${childLabel}${childRepeat} ${childDim} `;
        if (childLine.length <= innerW) {
          boxLines.push(`${BOX.v}${childLine}${' '.repeat(innerW - childLine.length)}${BOX.v}`);
        } else {
          boxLines.push(`${BOX.v}${childLine.slice(0, innerW)}${BOX.v}`);
        }
      }
    } else if (isFlexRow(node)) {
      // Calculate expanded count (considering repeat)
      const expandedCount = children.reduce((sum, c) => sum + (c.repeat && c.repeat > 1 ? c.repeat : 1), 0);
      if (expandedCount > 1) {
        const childLines = renderFlexChildren(children, innerW, depth + 1, m.width);
        for (const cl of childLines) {
          boxLines.push(`${BOX.v}${cl}${BOX.v}`);
        }
      } else {
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
    } else {
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
    // Expand repeat nodes into multiple copies
    const expanded: TreeNode[] = [];
    for (const child of children) {
      const repeat = child.repeat && child.repeat > 1 ? child.repeat : 1;
      for (let r = 0; r < repeat; r++) {
        expanded.push({ ...child, repeat: 1, children: child.children });
      }
    }

    const gap = 1;
    const totalGaps = (expanded.length - 1) * gap;
    const usableW = Math.max(availW - totalGaps, expanded.length * 8);
    const childWidths: number[] = [];
    let totalUsed = 0;
    for (let i = 0; i < expanded.length; i++) {
      const ratio = expanded[i].metrics.rect.width / parentPxW;
      const w = Math.max(Math.round(usableW * ratio), 8);
      childWidths.push(w);
      totalUsed += w;
    }
    if (childWidths.length > 0) {
      childWidths[childWidths.length - 1] += usableW - totalUsed;
    }

    const childBoxes: string[][] = [];
    let maxLines = 0;
    for (let i = 0; i < expanded.length; i++) {
      const box = renderBox(expanded[i], childWidths[i], depth, true);
      childBoxes.push(box);
      if (box.length > maxLines) maxLines = box.length;
    }

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
