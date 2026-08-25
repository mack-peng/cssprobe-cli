import type { AncestorNode } from '../types';

export function renderAncestors(chain: AncestorNode[]): string[] {
  return chain.map(a => {
    const dh = a.declared && a.declared.height ? a.declared.height.map(x => `${x.selector}\u2192${x.value}`).join('; ') : 'auto';
    const dw = a.declared && a.declared.width ? a.declared.width.map(x => `${x.selector}\u2192${x.value}`).join('; ') : 'auto';
    const mh = a.declared && a.declared['max-height'] ? a.declared['max-height'].map(x => `${x.selector}\u2192${x.value}`).join('; ') : null;
    const maxPart = mh ? ` max-height:${mh}` : '';
    const s = a.shape || {};
    const shapeStr = s.role ? `[${s.role}${s.scrollTag ? ' ' + s.scrollTag : ''} h:${s.heightStrategy} w:${s.widthStrategy}]` : '';
    return `${a.label} ${shapeStr} [${a.props.position},${a.props.display}] h:${dh}${maxPart} w:${dw} \u2192 ${a.metrics.clientWidth}\u00D7${a.metrics.offsetHeight}` +
      (a.containingBlockModifiers.length ? ` CB:${a.containingBlockModifiers.join(' ')}` : '') +
      (a.inlineStyle ? ` style="${a.inlineStyle}"` : '');
  });
}
