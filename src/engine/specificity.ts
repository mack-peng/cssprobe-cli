export interface DeclaredLike {
  selector: string;
  value: string;
}

export function specificity(selector: string): number {
  if (selector === 'inline') return Number.MAX_SAFE_INTEGER;
  let score = 0;
  for (const token of selector.split(/[ >+~]+/)) {
    const ids = (token.match(/#[\w-]+/g) || []).length;
    const attrsClasses = (token.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
    const types = (token.match(/^[\w-]+|::[\w-]+/g) || []).length;
    score += ids * 100 + attrsClasses * 10 + types;
  }
  return score;
}

export function pickWinning<T extends DeclaredLike>(arr: T[]): T {
  if (arr.length === 0) return arr[0];
  let winner = arr[0];
  let best = -1;
  for (const d of arr) {
    const s = d.selector === 'inline' ? Number.MAX_SAFE_INTEGER : specificity(d.selector);
    if (s >= best) {
      best = s;
      winner = d;
    }
  }
  return winner;
}