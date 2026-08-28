import type { Snapshot, TreeNode, Finding } from '../types';
import { nodeLabel, smartLabel, isMultiColumn, BOX } from './utils';

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

  function renderBox(node: TreeNode, charW: number, depth: number, flat = false, absMark = ''): string[] {
    const m = node.metrics.rect;
    const dimStr = `${Math.round(m.width)}\u00D7${Math.round(m.height)}`;
    const innerW = Math.max(charW - 2, 1);
    const label = absMark + smartLabel(node, innerW - 4 - absMark.length);
    const hasIssue = issueLocations.has(label.replace(absMark, ''));
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

    // Children — split into normal flow and absolutely positioned
    const allChildren = node.children.filter(c => !(c.metrics.rect.width < 1 && c.metrics.rect.height < 1));
    const flowChildren = allChildren.filter(c => c.props.position !== 'absolute');
    const absChildren = allChildren.filter(c => c.props.position === 'absolute');

    // If there are absolute children, render all children side-by-side by x position
    if (absChildren.length > 0 && !flat) {
      const allSorted = [...allChildren].sort((a, b) => a.metrics.rect.x - b.metrics.rect.x);
      // Assign character widths proportional to pixel widths
      const totalPx = allSorted.reduce((sum, c) => sum + c.metrics.rect.width, 0);
      const childWidths: number[] = [];
      let totalUsed = 0;
      for (let i = 0; i < allSorted.length; i++) {
        const ratio = allSorted[i].metrics.rect.width / totalPx;
        const w = Math.max(Math.round(innerW * ratio), 14);
        childWidths.push(w);
        totalUsed += w;
      }
      if (childWidths.length > 0 && innerW > totalUsed) {
        childWidths[childWidths.length - 1] += innerW - totalUsed;
      }

      const childBoxes: string[][] = [];
      let maxLines = 0;
      for (let i = 0; i < allSorted.length; i++) {
        const isAbs = allSorted[i].props.position === 'absolute';
        const absMark = isAbs ? '[abs] ' : '';
        const box = renderBox(allSorted[i], childWidths[i], depth + 1, true, absMark);
        childBoxes.push(box);
        if (box.length > maxLines) maxLines = box.length;
      }

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
        boxLines.push(`${BOX.v}${merged}${BOX.v}`);
      }
    } else {
      // No absolute children — render flow children normally
      const children = flowChildren;
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
      } else if (isMultiColumn(node)) {
        const expandedCount = children.reduce((sum, c) => sum + (c.repeat && c.repeat > 1 ? c.repeat : 1), 0);
        if (expandedCount > 1) {
          const isGrid = node.props.display === 'grid' || node.props.display === 'inline-grid';
          const childLines = renderFlexChildren(children, innerW, depth + 1, m.width, isGrid);
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
    }

    boxLines.push(`${BOX.bl}${BOX.h.repeat(innerW)}${BOX.br}`);
    return boxLines;
  }

  function renderFlexChildren(children: TreeNode[], availW: number, depth: number, parentPxW: number, isGrid: boolean): string[] {
    // Expand repeat nodes into multiple copies
    const expanded: TreeNode[] = [];
    for (const child of children) {
      const repeat = child.repeat && child.repeat > 1 ? child.repeat : 1;
      for (let r = 0; r < repeat; r++) {
        expanded.push({ ...child, repeat: 1, children: child.children });
      }
    }

    // For grid: group into rows based on column count
    let rows: TreeNode[][];
    if (isGrid && expanded.length > 1) {
      const childW = expanded[0].metrics.rect.width;
      const cols = Math.max(1, Math.floor(parentPxW / childW));
      rows = [];
      for (let i = 0; i < expanded.length; i += cols) {
        rows.push(expanded.slice(i, i + cols));
      }
    } else {
      rows = [expanded];
    }

    const allResult: string[] = [];
    for (const row of rows) {
      const gap = 1;
      const totalGaps = (row.length - 1) * gap;
      const minPerChild = 10;
      const usableW = Math.max(availW - totalGaps, row.length * minPerChild);

      const childWidths: number[] = [];
      let totalUsed = 0;
      for (let i = 0; i < row.length; i++) {
        const ratio = row[i].metrics.rect.width / parentPxW;
        const w = Math.max(Math.round(usableW * ratio), minPerChild);
        childWidths.push(w);
        totalUsed += w;
      }
      if (childWidths.length > 0 && usableW > totalUsed) {
        childWidths[childWidths.length - 1] += usableW - totalUsed;
      }

      const childBoxes: string[][] = [];
      let maxLines = 0;
      for (let i = 0; i < row.length; i++) {
        const box = renderBox(row[i], childWidths[i], depth, true);
        childBoxes.push(box);
        if (box.length > maxLines) maxLines = box.length;
      }

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
        allResult.push(merged);
      }
    }

    return allResult;
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
