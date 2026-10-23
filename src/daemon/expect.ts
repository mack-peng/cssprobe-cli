function labelSuffix(label?: string): string {
  return label ? ` (${label})` : '';
}

function fail(label: string | undefined, message: string): never {
  throw new Error(`expect${labelSuffix(label)}: ${message}`);
}

export interface Matchers {
  toBe(expected: unknown, label?: string): void;
  toBeWithin(expected: number, tolerance: number, label?: string): void;
  toMatch(pattern: RegExp | string, label?: string): void;
  toHaveHash(hash: string, label?: string): void;
  toBeSelected(index: number, label?: string): void;
}

export function expect(actual: unknown): Matchers {
  return {
    toBe(expected, label) {
      if (actual !== expected) {
        fail(label, `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
      }
    },
    toBeWithin(expected, tolerance, label) {
      if (typeof actual !== 'number' || !Number.isFinite(actual)) {
        fail(label, `expected a finite number near ${expected}, received ${JSON.stringify(actual)}`);
      }
      if (Math.abs(actual - expected) > tolerance) {
        fail(label, `expected ${expected} ±${tolerance}, received ${actual}`);
      }
    },
    toMatch(pattern, label) {
      if (typeof actual !== 'string') {
        fail(label, `expected a string, received ${JSON.stringify(actual)}`);
      }
      const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
      if (!regex.test(actual as string)) {
        fail(label, `expected ${JSON.stringify(actual)} to match ${regex}`);
      }
    },
    toHaveHash(hash, label) {
      const expected = hash.startsWith('#') ? hash : `#${hash}`;
      if (actual !== expected) {
        fail(label, `expected hash ${expected}, received ${JSON.stringify(actual)}`);
      }
    },
    toBeSelected(index, label) {
      if (actual !== index) {
        fail(label, `expected selected index ${index}, received ${JSON.stringify(actual)}`);
      }
    },
  };
}
