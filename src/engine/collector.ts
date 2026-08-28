// Browser-side collector. Bundled by esbuild into an IIFE (global `__cssprobe_cli`),
// injected into the page via addScriptTag, then invoked with `window.__cssprobe_cli.collect(cfg)`.
// This module runs entirely in the browser context — no Node imports at runtime.

import type {
  CollectConfig,
  Snapshot,
  TreeNode,
  AncestorNode,
  DeclaredValue,
  NodeProps,
  ShapeInfo,
} from './types';
import { pickWinning } from './specificity';

// ─── Declared-value scanning ───

const WANTED_PROPS = [
  // layout
  'height', 'max-height', 'min-height', 'width', 'max-width', 'min-width',
  'overflow', 'overflow-x', 'overflow-y',
  'position', 'display', 'box-sizing',
  'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex-direction',
  'align-items', 'justify-content', 'align-self',
  'grid-template-columns', 'grid-template-rows',
  'top', 'left', 'right', 'bottom',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom',
  'transform', 'filter', 'perspective', 'will-change', 'contain',
  'z-index', 'visibility', 'opacity',
  // visual (colors / backgrounds / fonts)
  'color', 'background', 'background-color', 'background-image',
  'background-size', 'background-position', 'background-repeat',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'text-align', 'letter-spacing', 'text-transform',
];

function matchDeclarations(
  el: Element,
  wantedProps: string[],
  crossOriginBlocked: { count: number },
  blockedSheetUrls: string[],
): Record<string, DeclaredValue[]> {
  const out: Record<string, DeclaredValue[]> = {};
  let scanned = 0;
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    let accessible = true;
    try {
      rules = sheet.cssRules;
    } catch (_e) {
      accessible = false;
      crossOriginBlocked.count++;
      const short = (sheet.href || 'unknown').split('/').pop() || 'unknown';
      if (!blockedSheetUrls.includes(short)) blockedSheetUrls.push(short);
      continue;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      const styleRule = rule as CSSStyleRule;
      if (styleRule.selectorText && el.matches && el.matches(styleRule.selectorText)) {
        const decls = styleRule.style;
        for (const p of wantedProps) {
          const v = decls.getPropertyValue(p);
          if (v) {
            (out[p] = out[p] || []).push({
              selector: styleRule.selectorText,
              value: v.trim(),
              href: (sheet.href || '').split('/').slice(-2).join('/'),
              accessible,
            });
          }
        }
      }
      scanned += 1;
      if (scanned > 8000) return out;
    }
  }
  for (const p of wantedProps) {
    const iv = (el as HTMLElement).style.getPropertyValue(p);
    if (iv && !(out[p] || []).some(d => d.selector === 'inline')) {
      (out[p] = out[p] || []).push({ selector: 'inline', value: iv.trim(), href: '', accessible: true });
    }
  }
  return out;
}

// ─── Shape classification ───

export function classifyShape(
  cs: CSSStyleDeclaration,
  declared: Record<string, DeclaredValue[]>,
): ShapeInfo {
  const display = cs.display;
  const position = cs.position;
  const flexDir = cs.flexDirection;
  const floatVal = cs.float;
  const overflowY = cs.overflowY;
  const overflowX = cs.overflowX;

  let role = 'block';
  if (position === 'fixed') role = 'fixed';
  else if (position === 'absolute') role = 'absolute';
  else if (position === 'sticky') role = 'sticky';
  else if (display === 'grid' || display === 'inline-grid') role = 'grid';
  else if (floatVal && floatVal !== 'none') role = 'float';
  else if (display === 'flex' || display === 'inline-flex') {
    role = flexDir === 'column' ? 'flex-col' : 'flex-row';
  } else if (display === 'inline' || display === 'inline-block') role = 'inline';

  const isScrollY = overflowY === 'auto' || overflowY === 'scroll';
  const isScrollX = overflowX === 'auto' || overflowX === 'scroll';
  const scrollTag = isScrollY ? (isScrollX ? 'scroll-xy' : 'scroll-y') : (isScrollX ? 'scroll-x' : '');

  const getDeclared = (prop: string): string | null => {
    const arr = declared && declared[prop];
    if (!arr || arr.length === 0) return null;
    return pickWinning(arr).value;
  };

  const sizeClass = (prop: string, maxProp: string): string => {
    const val = getDeclared(prop);
    const maxVal = getDeclared(maxProp);
    if (val) {
      if (/^(0|[1-9]\d*)(\.\d+)?(px|pt|cm|mm|in)$/.test(val)) return 'fixed';
      if (/^(0|[1-9]\d*)(\.\d+)?(vh|vw|vmin|vmax)$/.test(val)) return 'viewport';
      if (val.endsWith('%')) return 'percent';
      if (/^calc\(/.test(val)) return 'calc';
      if (val === 'min-content' || val === 'max-content' || val === 'fit-content') return 'content';
    }
    if (maxVal && maxVal !== 'none' && maxVal !== 'auto') return 'constrained';
    return 'content';
  };

  const heightStrategy = sizeClass('height', 'max-height');
  const widthStrategy = sizeClass('width', 'max-width');
  const isFlexChild = !!(getDeclared('flex-grow') || getDeclared('flex-shrink') || getDeclared('flex-basis') || getDeclared('flex'));

  return { role, scrollTag, heightStrategy, widthStrategy, isFlexChild };
}

// ─── Node collection ───

const CB_PROPS = ['transform', 'filter', 'perspective', 'willChange', 'contain'];

function collectNode(
  el: Element,
  maxText: number,
  crossOriginBlocked: { count: number },
  blockedSheetUrls: string[],
): Omit<TreeNode, 'children'> | null {
  try {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (!rect) return null;

    const props: NodeProps = {} as NodeProps;
    const LAYOUT_PROPS = [
      'position', 'display', 'height', 'width', 'minHeight', 'maxHeight',
      'overflowX', 'overflowY', 'boxSizing', 'margin', 'padding', 'float',
      'flexDirection', 'flexGrow', 'flexShrink', 'flexBasis', 'alignItems', 'justifyContent',
      'transform', 'filter', 'perspective', 'willChange', 'contain',
      'zIndex', 'top', 'left', 'right', 'bottom', 'visibility', 'opacity',
    ];
    for (const p of LAYOUT_PROPS) props[p] = (cs as any)[p] ?? '';

    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, maxText);
    const declared = matchDeclarations(el, WANTED_PROPS, crossOriginBlocked, blockedSheetUrls);
    const shape = classifyShape(cs, declared);
    const rawClass = el.getAttribute('class') || '';

    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: rawClass.split(/\s+/).filter(Boolean),
      inlineStyle: el.getAttribute('style') || null,
      text,
      props,
      declared,
      shape,
      metrics: {
        rect: {
          x: +rect.x.toFixed(1),
          y: +rect.y.toFixed(1),
          width: +rect.width.toFixed(1),
          height: +rect.height.toFixed(1),
        },
        rectBottom: +rect.bottom.toFixed(1),
        rectRight: +rect.right.toFixed(1),
        offsetHeight: (el as HTMLElement).offsetHeight,
        clientHeight: (el as HTMLElement).clientHeight,
        scrollHeight: (el as HTMLElement).scrollHeight,
        clientWidth: (el as HTMLElement).clientWidth,
        scrollWidth: (el as HTMLElement).scrollWidth,
      },
      flags: {
        overflowsViewport: rect.bottom > innerHeight + 1 || rect.right > innerWidth + 1,
        overflowsParent: rect.bottom > (el.parentElement ? el.parentElement.getBoundingClientRect().bottom + 1 : innerHeight),
        hasScrollY: (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 1,
        hasScrollX: (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1,
        scrollable: (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
          (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 1 &&
          (el as HTMLElement).clientHeight > 0,
      },
      containingBlockModifiers: CB_PROPS.filter(p => {
        const v = (cs as any)[p];
        return v && v !== 'none' && v !== 'auto' && v !== 'normal' && v !== 'visible' && v !== 'false';
      }).map(p => `${p}: ${(cs as any)[p]}`),
    };
  } catch (_e) {
    return null;
  }
}

function isSameShape(a: Element, b: Element): boolean {
  return !!a && !!b && a.tagName === b.tagName && a.id === b.id &&
    (a.getAttribute('class') || '') === (b.getAttribute('class') || '');
}

function buildTree(
  el: Element | null,
  depth: number,
  state: { count: number },
  maxNodes: number,
  crossOriginBlocked: { count: number },
  blockedSheetUrls: string[],
): TreeNode | null {
  if (!el || state.count >= maxNodes || depth < 0) return null;
  state.count += 1;
  const collected = collectNode(el, 40, crossOriginBlocked, blockedSheetUrls);
  if (!collected) return null;
  const node: TreeNode = { ...collected, children: [] };
  const kids = Array.from(el.children);
  if (depth > 0) {
    let i = 0;
    while (i < kids.length) {
      const run = [kids[i]];
      let j = i + 1;
      while (j < kids.length && isSameShape(kids[i], kids[j])) { run.push(kids[j]); j += 1; }
      const rep = buildTree(run[0], depth - 1, state, maxNodes, crossOriginBlocked, blockedSheetUrls);
      if (rep) {
        node.children.push({ ...rep, repeat: run.length });
      }
      i = j;
    }
  }
  return node;
}

function walkUp(el: Element, stopTag: string): Element[] {
  const chain: Element[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName.toLowerCase() !== stopTag) {
    chain.unshift(cur);
    cur = cur.parentElement;
  }
  if (cur) chain.unshift(cur);
  return chain;
}

// ─── Entry point (invoked from Node via window.__cssprobe_cli.collect) ───

export function collect(cfg: CollectConfig): Snapshot {
  const crossOriginBlocked = { count: 0 };
  const blockedSheetUrls: string[] = [];
  const viewport = { width: window.innerWidth, height: window.innerHeight };

  const root = document.querySelector(cfg.rootSelector);
  if (!root) {
    const candidates = Array.from(document.querySelectorAll('.s-kit-modal, [class*="dialog"], [class*="modal"], [class*="popup"]'))
      .slice(0, 5)
      .map(el => `${el.tagName}.${(el.getAttribute('class') || '').split(/\s+/).filter(Boolean).join('.')}`);
    return {
      rootSelector: cfg.rootSelector,
      upTo: cfg.upTo,
      downDepth: cfg.downDepth,
      maxNodes: cfg.maxNodes,
      nodeCount: 0,
      viewport,
      ancestors: [],
      tree: null,
      crossOriginBlocked: crossOriginBlocked.count,
      blockedSheetUrls: blockedSheetUrls.slice(0, 5),
      error: `Not found: ${cfg.rootSelector}`,
      candidates,
    };
  }

  const ancestors: AncestorNode[] = walkUp(root, cfg.upTo)
    .map(el => collectNode(el, 30, crossOriginBlocked, blockedSheetUrls))
    .filter((n): n is NonNullable<typeof n> => n !== null)
    .map(n => ({
      label: `${n.tag}.${n.classes.join('.')}`,
      props: n.props,
      metrics: n.metrics,
      flags: n.flags,
      declared: n.declared,
      shape: n.shape,
      containingBlockModifiers: n.containingBlockModifiers,
      inlineStyle: n.inlineStyle,
    }));

  const state = { count: 0 };
  const tree = buildTree(root, cfg.downDepth, state, cfg.maxNodes, crossOriginBlocked, blockedSheetUrls);

  return {
    rootSelector: cfg.rootSelector,
    upTo: cfg.upTo,
    downDepth: cfg.downDepth,
    maxNodes: cfg.maxNodes,
    nodeCount: state.count,
    viewport,
    ancestors,
    tree,
    crossOriginBlocked: crossOriginBlocked.count,
    blockedSheetUrls: blockedSheetUrls.slice(0, 5),
  };
}
