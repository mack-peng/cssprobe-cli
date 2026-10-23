export function looksLikeLoginUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return /\/(?:s\/)?login(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

export function matchesUrlPattern(pattern: string, raw: string): boolean {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    throw new Error(`Invalid --expect-url pattern: ${pattern}`);
  }
  return regex.test(raw);
}
