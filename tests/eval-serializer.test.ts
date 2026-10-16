import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { serializeEvalResult } from '../src/engine/evalSerializer';

class FakeNode {
  nodeType: number;
  nodeName: string;
  tagName: string;
  id: string;
  textContent: string;
  classList: string[];

  constructor(nodeType: number, nodeName: string, opts: Partial<FakeNode> = {}) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.tagName = opts.tagName ?? '';
    this.id = opts.id ?? '';
    this.textContent = opts.textContent ?? '';
    this.classList = opts.classList ?? [];
  }
}

describe('evalSerializer', () => {
  before(() => {
    (globalThis as any).Node = FakeNode;
  });

  after(() => {
    delete (globalThis as any).Node;
  });

  it('passes primitives through', () => {
    assert.strictEqual(serializeEvalResult(42), 42);
    assert.strictEqual(serializeEvalResult('str'), 'str');
    assert.strictEqual(serializeEvalResult(true), true);
    assert.strictEqual(serializeEvalResult(null), null);
    assert.strictEqual(serializeEvalResult(undefined), undefined);
  });

  it('serializes functions to a placeholder', () => {
    function named() {}
    assert.strictEqual(serializeEvalResult(named), '[Function: named]');
    assert.strictEqual(serializeEvalResult(() => {}), '[Function: anonymous]');
  });

  it('serializes bigint to a string', () => {
    assert.strictEqual(serializeEvalResult(42n), '42n');
  });

  it('serializes DOM elements to descriptors', () => {
    const el = new FakeNode(1, 'DIV', {
      tagName: 'DIV',
      id: 'app',
      classList: ['card', 'wide'],
      textContent: '  Hello world  ',
    });
    assert.deepStrictEqual(serializeEvalResult(el), {
      tag: 'div',
      id: 'app',
      classes: ['card', 'wide'],
      text: 'Hello world',
    });
  });

  it('truncates element text to 120 chars', () => {
    const el = new FakeNode(1, 'P', { tagName: 'P', textContent: 'x'.repeat(200) });
    const out = serializeEvalResult(el) as { text: string };
    assert.strictEqual(out.text.length, 120);
  });

  it('serializes non-element DOM nodes by nodeName', () => {
    const text = new FakeNode(3, '#text');
    assert.strictEqual(serializeEvalResult(text), '[#text]');
  });

  it('walks nested structures containing elements', () => {
    const el = new FakeNode(1, 'SPAN', { tagName: 'SPAN', textContent: 'hi' });
    const out = serializeEvalResult({ list: [el, 1] }) as any;
    assert.deepStrictEqual(out.list[0], { tag: 'span', id: '', classes: [], text: 'hi' });
    assert.strictEqual(out.list[1], 1);
  });

  it('marks circular references', () => {
    const obj: any = { name: 'loop' };
    obj.self = obj;
    assert.deepStrictEqual(serializeEvalResult(obj), { name: 'loop', self: '[Circular]' });
  });

  it('caps depth at 6 levels', () => {
    let chain: any = 'leaf';
    for (let i = 0; i < 8; i++) chain = { child: chain };
    const json = JSON.stringify(serializeEvalResult(chain));
    assert.ok(json.includes('[Depth limit]'));
  });

  it('keeps plain arrays and objects intact', () => {
    assert.deepStrictEqual(serializeEvalResult([1, [2, 3]]), [1, [2, 3]]);
    assert.deepStrictEqual(serializeEvalResult({ a: { b: 2 } }), { a: { b: 2 } });
  });
});
