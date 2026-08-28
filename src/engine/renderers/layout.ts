import type { Snapshot, TreeNode, Finding } from '../types';
import { nodeLabel, smartLabel, isMultiColumn, BOX } from './utils';

export function renderLayout(snapshot: Snapshot, findings: Finding[]): string[] {
  if (!snapshot.tree) return ['(empty tree)'];

  const vpW = snapshot.viewport.width;
  const termWidth = Math.min(Math.max(process.stdout?.columns || 80, 60), 120);
  const indentUnit = 2;
  const maxDepth = 8;
  const boxPad = 4;
  const extractedAbs = new Set<TreeNode>();

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

  /** Recursively collect all position:absolute nodes in a subtree. */
  function collectAbsDescendants(node: TreeNode, result: TreeNode[]): void {
    for (const child of node.children) {
      if (child.props.position === 'absolute') {
        result.push(child);
        // Don't recurse into absolute children — they're collected as units
      } else {
        // Recurse into non-absolute children to find deeper absolute descendants
        collectAbsDescendants(child, result);
      }
    }
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

    // Children — split into normal flow and absolutely positioned (direct children only)
    const allChildren = node.children.filter(c => !(c.metrics.rect.width < 1 && c.metrics.rect.height < 1));
    const flowChildren = allChildren.filter(c => c.props.position !== 'absolute');
    const absChildren = allChildren.filter(c => c.props.position === 'absolute');
    const hasFloatedChildren = flowChildren.some(c => c.props.float && c.props.float !== 'none');

    // If this node is a containing block, find all absolute descendants for column extraction
    const isContainingBlock = node.props.position !== 'static' || node.containingBlockModifiers.length > 0;
    let extractedDescendants: TreeNode[] = [];
    if (isContainingBlock && !flat) {
      // Collect from ALL children (not just flow) — absolute children in any subtree
      for (const child of allChildren) {
        if (child.props.position !== 'absolute') {
          collectAbsDescendants(child, extractedDescendants);
        }
      }
      // Filter out full-width absolute elements (headers, footers, toolbars)
      // These should be rendered inline, not as separate columns
      extractedDescendants = extractedDescendants.filter(abs => {
        return abs.metrics.rect.width < m.width * 0.8;
      });
      for (const abs of extractedDescendants) {
        extractedAbs.add(abs);
      }
    }

    // Merge: all absolute elements (direct + extracted) as columns alongside flow children
    // Mark direct abs children as extracted so they're skipped in nested rendering
    // Filter out full-width absolute elements (they should be rendered inline)
    const filteredAbsChildren = absChildren.filter(abs => abs.metrics.rect.width < m.width * 0.8);
    const filteredExtracted = extractedDescendants.filter(abs => abs.metrics.rect.width < m.width * 0.8);
    for (const abs of filteredAbsChildren) extractedAbs.add(abs);
    const allAbsMerged = [...filteredAbsChildren, ...filteredExtracted];
    if (allAbsMerged.length > 0 && !flat) {
      // Group ONLY flow children by horizontal overlap — overlapping flow elements stack in the same column
      const flowGroups: TreeNode[][] = [];
      const sortedFlow = [...flowChildren].sort((a, b) => a.metrics.rect.x - b.metrics.rect.x);
      for (const child of sortedFlow) {
        const cx = child.metrics.rect.x;
        const cr = cx + child.metrics.rect.width;
        let placed = false;
        for (const group of flowGroups) {
          const gx = group[0].metrics.rect.x;
          const gr = group[0].metrics.rect.x + group[0].metrics.rect.width;
          // Check if ranges overlap
          if (cx < gr && gx < cr) {
            group.push(child);
            placed = true;
            break;
          }
        }
        if (!placed) flowGroups.push([child]);
      }

      // Each flow group = one column (stacked), each abs element = one column
      type Column = { nodes: TreeNode[]; isAbs: boolean; width: number; sortX: number };
      const columns: Column[] = [];
      for (const group of flowGroups) {
        const maxW = Math.max(...group.map(c => c.metrics.rect.width));
        // Find the largest marginLeft in the subtree — this indicates reserved space for abs elements
        let maxMarginLeft = 0;
        function findMaxMargin(node: TreeNode): void {
          // Parse margin shorthand: "top right bottom left"
          const margin = node.props?.margin || '';
          if (margin) {
            const parts = margin.split(/\s+/);
            if (parts.length === 4) {
              const ml = parseFloat(parts[3]);
              if (!isNaN(ml) && ml > maxMarginLeft) maxMarginLeft = ml;
            } else if (parts.length === 2) {
              const ml = parseFloat(parts[1]);
              if (!isNaN(ml) && ml > maxMarginLeft) maxMarginLeft = ml;
            } else if (parts.length === 1) {
              const ml = parseFloat(parts[0]);
              if (!isNaN(ml) && ml > maxMarginLeft) maxMarginLeft = ml;
            }
          }
          for (const child of node.children) findMaxMargin(child);
        }
        for (const g of group) findMaxMargin(g);
        const effectiveX = group[0].metrics.rect.x + maxMarginLeft;
        columns.push({ nodes: group, isAbs: false, width: maxW, sortX: effectiveX });
      }
      for (const abs of allAbsMerged) {
        columns.push({ nodes: [abs], isAbs: true, width: abs.metrics.rect.width, sortX: abs.metrics.rect.x });
      }
      columns.sort((a, b) => a.sortX - b.sortX);

      // Assign character widths proportional to pixel widths
      const totalPx = columns.reduce((sum, c) => sum + c.width, 0);
      const colWidths: number[] = [];
      let totalUsed = 0;
      for (let i = 0; i < columns.length; i++) {
        const ratio = columns[i].width / totalPx;
        const w = Math.max(Math.round(innerW * ratio), 14);
        colWidths.push(w);
        totalUsed += w;
      }
      if (colWidths.length > 0 && innerW > totalUsed) {
        colWidths[colWidths.length - 1] += innerW - totalUsed;
      }

      // Render each column
      const colBoxes: string[][] = [];
      let maxLines = 0;
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const lines: string[] = [];
        for (const node of col.nodes) {
          const mark = col.isAbs ? '[abs] ' : '';
          const box = renderBox(node, colWidths[i], depth + 1, true, mark);
          lines.push(...box);
        }
        colBoxes.push(lines);
        if (lines.length > maxLines) maxLines = lines.length;
      }

      // Merge columns side by side
      for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
        let merged = '';
        for (let i = 0; i < colBoxes.length; i++) {
          const w = colWidths[i];
          if (i > 0) merged += ' ';
          if (lineIdx < colBoxes[i].length) {
            const line = colBoxes[i][lineIdx];
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
      // Standard rendering — skip extracted absolute descendants
      const children = allChildren.filter(c => !extractedAbs.has(c));
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
      } else if (hasFloatedChildren) {
        // Float layout — render floated children as columns
        const floated = children.filter(c => c.props.float && c.props.float !== 'none');

        // Group floated children by x position overlap
        const sortedFloated = [...floated].sort((a, b) => a.metrics.rect.x - b.metrics.rect.x);
        const floatGroups: TreeNode[][] = [];
        for (const child of sortedFloated) {
          const cx = child.metrics.rect.x;
          const cr = cx + child.metrics.rect.width;
          let placed = false;
          for (const group of floatGroups) {
            const gx = group[0].metrics.rect.x;
            const gr = group[0].metrics.rect.x + group[0].metrics.rect.width;
            if (cx < gr && gx < cr) {
              group.push(child);
              placed = true;
              break;
            }
          }
          if (!placed) floatGroups.push([child]);
        }

        type FloatCol = { nodes: TreeNode[]; width: number };
        const floatCols: FloatCol[] = [];
        for (const group of floatGroups) {
          const maxW = Math.max(...group.map(c => c.metrics.rect.width));
          floatCols.push({ nodes: group, width: maxW });
        }
        floatCols.sort((a, b) => a.nodes[0].metrics.rect.x - b.nodes[0].metrics.rect.x);

        const totalPx = floatCols.reduce((sum, c) => sum + c.width, 0);
        const colWidths: number[] = [];
        let totalUsed = 0;
        for (let i = 0; i < floatCols.length; i++) {
          const ratio = floatCols[i].width / totalPx;
          const w = Math.max(Math.round(innerW * ratio), 14);
          colWidths.push(w);
          totalUsed += w;
        }
        if (colWidths.length > 0 && innerW > totalUsed) {
          colWidths[colWidths.length - 1] += innerW - totalUsed;
        }

        const colBoxes: string[][] = [];
        let maxLines = 0;
        for (let i = 0; i < floatCols.length; i++) {
          const lines: string[] = [];
          for (const n of floatCols[i].nodes) {
            const box = renderBox(n, colWidths[i], depth + 1, true);
            lines.push(...box);
          }
          colBoxes.push(lines);
          if (lines.length > maxLines) maxLines = lines.length;
        }

        for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
          let merged = '';
          for (let i = 0; i < colBoxes.length; i++) {
            const w = colWidths[i];
            if (i > 0) merged += ' ';
            if (lineIdx < colBoxes[i].length) {
              const line = colBoxes[i][lineIdx];
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
