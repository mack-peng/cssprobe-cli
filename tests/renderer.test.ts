import { describe, it } from 'node:test';
import assert from 'node:assert';
import { renderMarkdown, renderJSON } from '../src/engine/renderer';
import type { Snapshot, TreeNode, Finding } from '../src/engine/types';

// ─── Helpers ───

function makeNode(overrides: Partial<TreeNode> & { tag: string }): TreeNode {
  return {
    id: null,
    classes: [],
    inlineStyle: null,
    text: '',
    props: { position: 'relative', display: 'block', height: 'auto', width: 'auto', minHeight: '0px', maxHeight: 'none', overflowY: 'visible', overflowX: 'visible', boxSizing: 'border-box', flexDirection: 'row', flexGrow: '0', flexShrink: '1', flexBasis: 'auto' } as any,
    declared: {},
    shape: { role: 'block', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false },
    metrics: { rect: { x: 0, y: 0, width: 100, height: 100 }, rectBottom: 100, rectRight: 100, offsetHeight: 100, clientHeight: 100, scrollHeight: 100, clientWidth: 100, scrollWidth: 100 },
    flags: { overflowsViewport: false, overflowsParent: false, hasScrollY: false, hasScrollX: false, scrollable: false },
    containingBlockModifiers: [],
    children: [],
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    rootSelector: '.test',
    upTo: 'html',
    downDepth: 6,
    maxNodes: 60,
    nodeCount: 1,
    viewport: { width: 1280, height: 720 },
    ancestors: [],
    tree: null,
    crossOriginBlocked: 0,
    blockedSheetUrls: [],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> & { id: string }): Finding {
  return {
    level: 'info',
    message: 'test finding',
    confidence: 'DEFINITE',
    evidence: [],
    ...overrides,
  };
}

// ─── Tests ───

describe('renderer', () => {
  describe('renderMarkdown', () => {
    it('renders header with viewport and root', () => {
      const snapshot = makeSnapshot();
      const result = renderMarkdown(snapshot, []);
      assert.ok(result.includes('1280\u00D7720'));
      assert.ok(result.includes('.test'));
    });

    it('renders ancestor chain', () => {
      const snapshot = makeSnapshot({
        ancestors: [{
          label: 'div.container',
          props: { position: 'relative', display: 'block' } as any,
          metrics: { rect: { x: 0, y: 0, width: 100, height: 100 }, rectBottom: 100, rectRight: 100, offsetHeight: 100, clientHeight: 100, scrollHeight: 100, clientWidth: 100, scrollWidth: 100 },
          flags: { overflowsViewport: false, overflowsParent: false, hasScrollY: false, hasScrollX: false, scrollable: false },
          declared: {},
          shape: { role: 'block', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false },
          containingBlockModifiers: [],
          inlineStyle: null,
        }],
      });
      const result = renderMarkdown(snapshot, []);
      assert.ok(result.includes('div.container'));
    });

    it('renders full DOM tree in non-brief mode', () => {
      const tree = makeNode({ tag: 'div', classes: ['root'], children: [makeNode({ tag: 'span' })] });
      const snapshot = makeSnapshot({ tree, nodeCount: 2 });
      const result = renderMarkdown(snapshot, []);
      assert.ok(result.includes('DOM tree'));
      assert.ok(result.includes('<div'));
      assert.ok(result.includes('<span'));
    });

    it('renders tree sketch in brief mode', () => {
      const tree = makeNode({ tag: 'div', classes: ['root'], children: [makeNode({ tag: 'span' })] });
      const snapshot = makeSnapshot({ tree, nodeCount: 2 });
      const result = renderMarkdown(snapshot, [], true);
      assert.ok(result.includes('Tree Sketch'));
      assert.ok(!result.includes('DOM tree'));
    });

    it('brief mode filters out info-level findings', () => {
      const findings = [
        makeFinding({ id: 'info-1', level: 'info', message: 'info finding' }),
        makeFinding({ id: 'warn-1', level: 'warning', message: 'warning finding' }),
        makeFinding({ id: 'err-1', level: 'error', message: 'error finding' }),
      ];
      const snapshot = makeSnapshot();
      const result = renderMarkdown(snapshot, findings, true);
      assert.ok(!result.includes('info finding'));
      assert.ok(result.includes('warning finding'));
      assert.ok(result.includes('error finding'));
    });

    it('non-brief mode shows all findings with evidence', () => {
      const findings = [
        makeFinding({
          id: 'test',
          level: 'warning',
          message: 'test warning',
          evidence: [{ type: 'computed', property: 'height', value: '100px' }],
        }),
      ];
      const snapshot = makeSnapshot();
      const result = renderMarkdown(snapshot, findings, false);
      assert.ok(result.includes('test warning'));
      assert.ok(result.includes('computed height: 100px'));
    });

    it('brief mode shows findings without evidence', () => {
      const findings = [
        makeFinding({
          id: 'test',
          level: 'warning',
          message: 'test warning',
          evidence: [{ type: 'computed', property: 'height', value: '100px' }],
        }),
      ];
      const snapshot = makeSnapshot();
      const result = renderMarkdown(snapshot, findings, true);
      assert.ok(result.includes('test warning'));
      assert.ok(!result.includes('computed height'));
    });
  });

  describe('renderJSON', () => {
    it('returns full snapshot in non-brief mode', () => {
      const tree = makeNode({ tag: 'div' });
      const snapshot = makeSnapshot({ tree, nodeCount: 1 });
      const result = renderJSON(snapshot, [], false) as any;
      assert.ok(result.snapshot.tree);
      assert.strictEqual(result.snapshot.tree.tag, 'div');
    });

    it('returns compact snapshot in brief mode', () => {
      const tree = makeNode({ tag: 'div' });
      const snapshot = makeSnapshot({ tree, nodeCount: 1 });
      const result = renderJSON(snapshot, [], true) as any;
      assert.strictEqual(result.snapshot.rootSelector, '.test');
      assert.strictEqual(result.snapshot.nodeCount, 1);
      assert.ok(!result.snapshot.tree);
    });

    it('brief mode filters findings to warning/error only', () => {
      const findings = [
        makeFinding({ id: 'info', level: 'info', message: 'info' }),
        makeFinding({ id: 'warn', level: 'warning', message: 'warn' }),
      ];
      const result = renderJSON(makeSnapshot(), findings, true) as any;
      assert.strictEqual(result.findings.length, 1);
      assert.strictEqual(result.findings[0].id, 'warn');
    });

    it('brief mode truncates evidence to 1 item', () => {
      const findings = [
        makeFinding({
          id: 'test',
          level: 'warning',
          message: 'test',
          evidence: [
            { type: 'computed', property: 'a', value: '1' },
            { type: 'computed', property: 'b', value: '2' },
          ],
        }),
      ];
      const result = renderJSON(makeSnapshot(), findings, true) as any;
      assert.strictEqual(result.findings[0].evidence.length, 1);
    });

    it('brief mode includes warnings/errors count in summary', () => {
      const findings = [
        makeFinding({ id: 'w1', level: 'warning', message: 'w1' }),
        makeFinding({ id: 'w2', level: 'warning', message: 'w2' }),
        makeFinding({ id: 'e1', level: 'error', message: 'e1' }),
      ];
      const result = renderJSON(makeSnapshot(), findings, true) as any;
      assert.strictEqual(result.summary.warnings, 2);
      assert.strictEqual(result.summary.errors, 1);
    });
  });

  describe('renderMarkdown with layout', () => {
    it('renders layout diagram when layout=true', () => {
      const tree = makeNode({ tag: 'div', classes: ['root'], children: [makeNode({ tag: 'span' })] });
      const snapshot = makeSnapshot({ tree, nodeCount: 2 });
      const result = renderMarkdown(snapshot, [], false, true);
      assert.ok(result.includes('Layout'));
      assert.ok(result.includes('\u250C')); // ┌
      assert.ok(result.includes('\u2514')); // └
      assert.ok(result.includes('\u2502')); // │
      assert.ok(!result.includes('DOM tree'));
    });

    it('shows viewport and scale info', () => {
      const tree = makeNode({ tag: 'div' });
      const snapshot = makeSnapshot({ tree, nodeCount: 1 });
      const result = renderMarkdown(snapshot, [], false, true);
      assert.ok(result.includes('1280\u00D7720'));
      assert.ok(result.includes('viewport'));
      assert.ok(result.includes('scale'));
    });

    it('shows dimensions for each element', () => {
      const tree = makeNode({ tag: 'div', metrics: { rect: { x: 0, y: 0, width: 960, height: 500 }, rectBottom: 500, rectRight: 960, offsetHeight: 500, clientHeight: 500, scrollHeight: 500, clientWidth: 960, scrollWidth: 960 } });
      const snapshot = makeSnapshot({ tree, nodeCount: 1 });
      const result = renderMarkdown(snapshot, [], false, true);
      assert.ok(result.includes('960\u00D7500'));
    });

    it('renders nested elements with indentation', () => {
      const child = makeNode({ tag: 'span', metrics: { rect: { x: 10, y: 10, width: 200, height: 50 }, rectBottom: 60, rectRight: 210, offsetHeight: 50, clientHeight: 50, scrollHeight: 50, clientWidth: 200, scrollWidth: 200 } });
      const tree = makeNode({ tag: 'div', children: [child] });
      const snapshot = makeSnapshot({ tree, nodeCount: 2 });
      const result = renderMarkdown(snapshot, [], false, true);
      const lines = result.split('\n');
      const layoutLines = lines.filter(l => l.includes('\u250C') || l.includes('\u2514'));
      assert.ok(layoutLines.length >= 4); // top+bottom for each element
    });

    it('marks issue elements with warning icon', () => {
      const tree = makeNode({ tag: 'div', classes: ['root'], flags: { overflowsViewport: true, overflowsParent: false, hasScrollY: false, hasScrollX: false, scrollable: false } });
      const findings = [makeFinding({ id: 'test', level: 'warning', message: 'test', location: 'div.root' })];
      const snapshot = makeSnapshot({ tree, nodeCount: 1 });
      const result = renderMarkdown(snapshot, findings, false, true);
      assert.ok(result.includes('\u26A0'));
    });

    it('layout mode skips DOM tree section', () => {
      const tree = makeNode({ tag: 'div' });
      const snapshot = makeSnapshot({ tree, nodeCount: 1 });
      const result = renderMarkdown(snapshot, [], false, true);
      assert.ok(!result.includes('DOM tree'));
      assert.ok(result.includes('Layout'));
    });

    it('layout + brief shows both layout and sketch', () => {
      const tree = makeNode({ tag: 'div', classes: ['root'], flags: { overflowsViewport: true, overflowsParent: false, hasScrollY: false, hasScrollX: false, scrollable: false } });
      const findings = [makeFinding({ id: 'test', level: 'warning', message: 'test', location: 'div.root' })];
      const snapshot = makeSnapshot({ tree, nodeCount: 1 });
      const result = renderMarkdown(snapshot, findings, true, true);
      assert.ok(result.includes('Layout'));
      assert.ok(result.includes('Tree Sketch'));
    });
  });
});
