export interface StorageCookie {
  name: string;
  domain: string;
  expires?: number;
}

export interface StateReport {
  cookies: number;
  domains: string[];
  expired: string[];
  sessionCookies: number;
  targetMatches: boolean | null;
  warnings: string[];
  ok: boolean;
}

function normalizeDomain(domain: string): string {
  return domain.replace(/^\./, '').toLowerCase();
}

export function analyzeState(
  state: { cookies?: StorageCookie[] },
  targetUrl?: string,
  nowMs: number = Date.now()
): StateReport {
  const cookies = state.cookies ?? [];
  const expired: string[] = [];
  let sessionCookies = 0;

  for (const cookie of cookies) {
    if (cookie.expires === undefined || cookie.expires <= 0) {
      sessionCookies++;
    } else if (cookie.expires * 1000 <= nowMs) {
      expired.push(cookie.name);
    }
  }

  const domains = Array.from(new Set(cookies.map(cookie => normalizeDomain(cookie.domain)))).sort();

  let targetMatches: boolean | null = null;
  if (targetUrl) {
    try {
      const host = new URL(targetUrl).hostname.toLowerCase();
      targetMatches = cookies.some(cookie => {
        const domain = normalizeDomain(cookie.domain);
        return host === domain || host.endsWith(`.${domain}`);
      });
    } catch {
      throw new Error(`Invalid --url value: ${targetUrl}`);
    }
  }

  const warnings: string[] = [];
  if (!cookies.length) warnings.push('no cookies in state file');
  if (expired.length) warnings.push(`expired cookies: ${expired.join(', ')}`);
  if (targetMatches === false) warnings.push(`no cookies match ${targetUrl}`);

  const ok = cookies.length > 0 && expired.length === 0 && targetMatches !== false;

  return { cookies: cookies.length, domains, expired, sessionCookies, targetMatches, warnings, ok };
}
