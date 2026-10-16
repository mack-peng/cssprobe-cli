// Self-contained serializer for eval results.
// Runs inside the page via JSHandle.evaluate (function source is transferred),
// and is unit-testable in Node — keep it free of external references.

export function serializeEvalResult(value: unknown): unknown {
  const seen = new WeakSet<object>();

  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'function') return `[Function: ${v.name || 'anonymous'}]`;
      if (typeof v === 'bigint') return `${v}n`;
      return v;
    }

    if (typeof Node !== 'undefined' && v instanceof Node) {
      if (v.nodeType === 1) {
        const el = v as Element;
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id,
          classes: Array.from(el.classList),
          text: (el.textContent ?? '').trim().slice(0, 120),
        };
      }
      return `[${v.nodeName}]`;
    }

    if (seen.has(v)) return '[Circular]';
    if (depth >= 6) return '[Depth limit]';
    seen.add(v);

    if (Array.isArray(v)) return v.map(item => walk(item, depth + 1));

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(v)) out[key] = walk(val, depth + 1);
    return out;
  };

  return walk(value, 0);
}
