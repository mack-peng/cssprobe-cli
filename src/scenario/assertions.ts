import type { AssertStep } from './schema';

export interface AssertionState {
  url: string;
  title: string;
  frames: number;
}

export interface AssertionContext {
  vars: Record<string, unknown>;
  state: AssertionState;
  globals: Record<string, string>;
}

export function resolvePath(value: unknown, path?: string): unknown {
  if (!path) return value;
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object).sort();
    const bKeys = Object.keys(b as object).sort();
    if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index])) return false;
    return aKeys.every(key =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    );
  }
  return false;
}

function label(assertion: AssertStep): string {
  return assertion.label ?? 'assert';
}

export function evaluateAssertion(assertion: AssertStep, context: AssertionContext): string | null {
  const errors: string[] = [];

  if (assertion.url) {
    let regex: RegExp;
    try {
      regex = new RegExp(assertion.url);
    } catch {
      return `${label(assertion)}: invalid url pattern ${assertion.url}`;
    }
    if (!regex.test(context.state.url)) {
      errors.push(`url ${JSON.stringify(context.state.url)} does not match ${assertion.url}`);
    }
  }

  for (const [name, expected] of Object.entries(assertion.globals ?? {})) {
    const actual = context.globals[name] ?? 'undefined';
    if (actual !== expected) {
      errors.push(`global ${name}: expected ${expected}, received ${actual}`);
    }
  }

  for (const name of assertion.absent ?? []) {
    const actual = context.globals[name] ?? 'undefined';
    if (actual !== 'undefined') {
      errors.push(`global ${name}: expected absent, received ${actual}`);
    }
  }

  const hasValueCheck = ['eq', 'ne', 'match', 'within', 'min', 'max'].some(key => key in assertion);
  if (!hasValueCheck) {
    return errors.length ? `${label(assertion)}: ${errors.join('; ')}` : null;
  }

  let value: unknown;
  if (assertion.on) {
    if (assertion.on === 'state') {
      value = context.state;
    } else if (assertion.on in context.vars) {
      value = context.vars[assertion.on];
    } else {
      return `${label(assertion)}: unknown variable "${assertion.on}"`;
    }
  } else {
    value = context.state;
  }
  value = resolvePath(value, assertion.path);

  if ('eq' in assertion && !deepEqual(value, assertion.eq)) {
    errors.push(`expected ${JSON.stringify(assertion.eq)}, received ${JSON.stringify(value)}`);
  }
  if ('ne' in assertion && deepEqual(value, assertion.ne)) {
    errors.push(`expected value different from ${JSON.stringify(assertion.ne)}`);
  }
  if (assertion.match !== undefined) {
    const actual = typeof value === 'string' ? value : JSON.stringify(value);
    if (!new RegExp(assertion.match).test(actual)) {
      errors.push(`expected ${JSON.stringify(actual)} to match ${assertion.match}`);
    }
  }
  if (assertion.within) {
    if (typeof value !== 'number' || Math.abs(value - assertion.within.expected) > assertion.within.tolerance) {
      errors.push(
        `expected ${assertion.within.expected} ±${assertion.within.tolerance}, received ${JSON.stringify(value)}`
      );
    }
  }
  if (assertion.min !== undefined && (typeof value !== 'number' || value < assertion.min)) {
    errors.push(`expected >= ${assertion.min}, received ${JSON.stringify(value)}`);
  }
  if (assertion.max !== undefined && (typeof value !== 'number' || value > assertion.max)) {
    errors.push(`expected <= ${assertion.max}, received ${JSON.stringify(value)}`);
  }

  return errors.length ? `${label(assertion)}: ${errors.join('; ')}` : null;
}
