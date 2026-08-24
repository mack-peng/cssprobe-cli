import { describe, it } from 'node:test';
import assert from 'node:assert';
import { analyze } from '../src/engine/analyzer';
import type { Snapshot, TreeNode, AncestorNode } from '../src/engine/types';

// ─── Helpers to build test snapshots ───

function makeAncestor(overrides: Partial<AncestorNode> & { label: string }): AncestorNode {
  return {
    props: {} as any,
    metrics: { rect: { x: 0, y: 0, width: 100, height: 100 }, rectBottom: 100, rectRight: 100, offsetHeight: 100, clientHeight: 100, scrollHeight: 100, clientWidth: 100, scrollWidth: 100 },
    flags: { overflowsViewport: false, overflowsParent: false, hasScrollY: false, hasScrollX: false, scrollable: false },
    declared: {},
    shape: { role: 'block', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false },
    containingBlockModifiers: [],
    inlineStyle: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<Snapshot> & { ancestors?: Partial<AncestorNode>[] }): Snapshot {
  const ancestors = (overrides.ancestors || []).map(a => makeAncestor(a as any));
  return {
    rootSelector: '.test',
    upTo: 'html',
    downDepth: 6,
    maxNodes: 60,
    nodeCount: 1,
    viewport: { width: 1280, height: 720 },
    ancestors,
    tree: null,
    crossOriginBlocked: 0,
    blockedSheetUrls: [],
    ...overrides,
    ancestors,
  };
}

// ─── Tests ───

describe('analyzer', () => {
  describe('anchor analysis', () => {
    it('detects missing height anchor when all ancestors are content-sized', () => {
      const snapshot = makeSnapshot({
        ancestors: [
          { label: 'html.', shape: { role: 'block', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false } },
          { label: 'body.', shape: { role: 'block', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false } },
          { label: 'div.modal', shape: { role: 'block', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false } },
        ],
      });
      const findings = analyze(snapshot);
      const anchor = findings.find(f => f.id === 'anchor-missing');
      assert.ok(anchor, 'should find anchor-missing');
      assert.strictEqual(anchor.level, 'warning');
    });

    it('detects present height anchor when one ancestor has absolute-unit height', () => {
      const snapshot = makeSnapshot({
        ancestors: [
          { label: 'html.', declared: { height: [{ selector: 'html', value: '100vh', href: '', accessible: true }] }, shape: { role: 'block', scrollTag: '', heightStrategy: 'viewport', widthStrategy: 'content', isFlexChild: false } },
          { label: 'body.', shape: { role: 'block', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false } },
          { label: 'div.modal', shape: { role: 'block', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false } },
        ],
      });
      const findings = analyze(snapshot);
      const anchor = findings.find(f => f.id === 'anchor-present');
      assert.ok(anchor, 'should find anchor-present');
      assert.strictEqual(anchor.level, 'info');
    });

    it('marks UNVERIFIABLE when declared values come from blocked sheets', () => {
      const snapshot = makeSnapshot({
        ancestors: [
          { label: 'html.', declared: { height: [{ selector: 'html', value: '100%', href: 'blocked.css', accessible: false }] }, shape: { role: 'block', scrollTag: '', heightStrategy: 'percent', widthStrategy: 'content', isFlexChild: false } },
          { label: 'body.', shape: { role: 'block', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false } },
        ],
      });
      const findings = analyze(snapshot);
      const anchor = findings.find(f => f.id === 'anchor-missing' || f.id === 'anchor-present');
      assert.ok(anchor);
      assert.strictEqual(anchor.confidence, 'UNVERIFIABLE');
    });
  });

  describe('scroll analysis', () => {
    it('detects scrollable container', () => {
      const scrollNode: TreeNode = {
        tag: 'div', id: null, classes: ['scroll-container'], inlineStyle: null, text: '',
        props: { overflowY: 'auto', overflowX: 'visible', position: 'relative', display: 'block', height: '200px', width: '100%', minHeight: '0px', maxHeight: 'none', boxSizing: 'border-box', flexDirection: 'row', flexGrow: '0', flexShrink: '1', flexBasis: 'auto' } as any,
        declared: { height: [{ selector: '.scroll-container', value: '200px', href: '', accessible: true }] },
        shape: { role: 'block', scrollTag: 'scroll-y', heightStrategy: 'fixed', widthStrategy: 'content', isFlexChild: false },
        metrics: { rect: { x: 0, y: 0, width: 100, height: 200 }, rectBottom: 200, rectRight: 100, offsetHeight: 200, clientHeight: 200, scrollHeight: 500, clientWidth: 100, scrollWidth: 100 },
        flags: { overflowsViewport: false, overflowsParent: false, hasScrollY: true, hasScrollX: false, scrollable: true },
        containingBlockModifiers: [],
        children: [],
      };
      const snapshot: Snapshot = {
        rootSelector: '.scroll-container', upTo: 'html', downDepth: 6, maxNodes: 60, nodeCount: 1,
        viewport: { width: 1280, height: 720 },
        ancestors: [],
        tree: scrollNode,
        crossOriginBlocked: 0, blockedSheetUrls: [],
      };
      const findings = analyze(snapshot);
      const scrollable = findings.find(f => f.id === 'scrollable');
      assert.ok(scrollable, 'should find scrollable');
      assert.strictEqual(scrollable.level, 'info');
      assert.strictEqual(scrollable.confidence, 'DEFINITE');
    });

    it('detects collapsed scroll container (clientHeight=0)', () => {
      const scrollNode: TreeNode = {
        tag: 'div', id: null, classes: ['collapsed'], inlineStyle: null, text: '',
        props: { overflowY: 'auto', overflowX: 'visible', position: 'relative', display: 'block', height: 'auto', width: '100%', minHeight: '0px', maxHeight: 'none', boxSizing: 'border-box', flexDirection: 'row', flexGrow: '0', flexShrink: '1', flexBasis: 'auto' } as any,
        declared: {},
        shape: { role: 'block', scrollTag: 'scroll-y', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false },
        metrics: { rect: { x: 0, y: 0, width: 100, height: 0 }, rectBottom: 0, rectRight: 100, offsetHeight: 0, clientHeight: 0, scrollHeight: 500, clientWidth: 100, scrollWidth: 100 },
        flags: { overflowsViewport: false, overflowsParent: false, hasScrollY: true, hasScrollX: false, scrollable: false },
        containingBlockModifiers: [],
        children: [],
      };
      const snapshot: Snapshot = {
        rootSelector: '.collapsed', upTo: 'html', downDepth: 6, maxNodes: 60, nodeCount: 1,
        viewport: { width: 1280, height: 720 },
        ancestors: [],
        tree: scrollNode,
        crossOriginBlocked: 0, blockedSheetUrls: [],
      };
      const findings = analyze(snapshot);
      const collapsed = findings.find(f => f.id === 'scroll-collapsed');
      assert.ok(collapsed, 'should find scroll-collapsed');
      assert.strictEqual(collapsed.level, 'error');
    });
  });

  describe('pattern detection', () => {
    it('detects all-content-sized pattern', () => {
      const snapshot = makeSnapshot({
        ancestors: [
          { label: 'html.', shape: { role: 'block', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false } },
          { label: 'body.', shape: { role: 'block', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false } },
        ],
      });
      const findings = analyze(snapshot);
      const pattern = findings.find(f => f.id === 'pattern-content-sized');
      assert.ok(pattern, 'should find pattern-content-sized');
      assert.strictEqual(pattern.confidence, 'DEFINITE');
    });

    it('detects flex-col pattern', () => {
      const snapshot = makeSnapshot({
        ancestors: [
          { label: 'html.', shape: { role: 'block', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false } },
          { label: 'div.flex-parent', shape: { role: 'flex-col', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false } },
        ],
      });
      const findings = analyze(snapshot);
      const pattern = findings.find(f => f.id === 'pattern-flex-col');
      assert.ok(pattern, 'should find pattern-flex-col');
    });
  });

  describe('confidence model', () => {
    it('returns DEFINITE when declared values are accessible', () => {
      const snapshot = makeSnapshot({
        ancestors: [
          { label: 'html.', declared: { height: [{ selector: 'html', value: '100vh', href: 'main.css', accessible: true }] }, shape: { role: 'block', scrollTag: '', heightStrategy: 'viewport', widthStrategy: 'content', isFlexChild: false } },
          { label: 'body.', shape: { role: 'block', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false } },
        ],
      });
      const findings = analyze(snapshot);
      const anchor = findings.find(f => f.id === 'anchor-present');
      assert.ok(anchor);
      assert.strictEqual(anchor.confidence, 'DEFINITE');
    });

    it('returns UNVERIFIABLE when some ancestors lack declarations', () => {
      const snapshot = makeSnapshot({
        ancestors: [
          { label: 'html.', declared: { height: [{ selector: 'html', value: '100%', href: 'main.css', accessible: true }] }, shape: { role: 'block', scrollTag: '', heightStrategy: 'percent', widthStrategy: 'content', isFlexChild: false } },
          { label: 'body.', shape: { role: 'block', scrollTag: '', heightStrategy: 'content', widthStrategy: 'content', isFlexChild: false } },
        ],
      });
      const findings = analyze(snapshot);
      const anchor = findings.find(f => f.id === 'anchor-missing');
      assert.ok(anchor);
      // body has no declared height → overall confidence is UNVERIFIABLE
      assert.strictEqual(anchor.confidence, 'UNVERIFIABLE');
    });

    it('returns INDEFINITE when all ancestors have percent declarations', () => {
      const snapshot = makeSnapshot({
        ancestors: [
          { label: 'html.', declared: { height: [{ selector: 'html', value: '100%', href: 'main.css', accessible: true }] }, shape: { role: 'block', scrollTag: '', heightStrategy: 'percent', widthStrategy: 'content', isFlexChild: false } },
          { label: 'body.', declared: { height: [{ selector: 'body', value: '100%', href: 'main.css', accessible: true }] }, shape: { role: 'block', scrollTag: '', heightStrategy: 'percent', widthStrategy: 'content', isFlexChild: false } },
        ],
      });
      const findings = analyze(snapshot);
      const anchor = findings.find(f => f.id === 'anchor-missing');
      assert.ok(anchor);
      assert.strictEqual(anchor.confidence, 'INDEFINITE');
    });
  });
});
