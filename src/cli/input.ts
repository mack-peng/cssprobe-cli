import fs from 'fs';
import path from 'path';

export interface InputSource {
  readFile?: (file: string) => string;
  readStdin?: () => string;
  exists?: (file: string) => boolean;
}

export function resolveInputArg(value: string, source: InputSource = {}): string {
  const exists = source.exists ?? fs.existsSync;
  const readFile = source.readFile ?? ((file: string) => fs.readFileSync(file, 'utf-8'));

  if (value === '-') {
    const readStdin = source.readStdin ?? (() => fs.readFileSync(0, 'utf-8'));
    return readStdin();
  }

  if (value.startsWith('@')) {
    const file = path.resolve(value.slice(1));
    if (!exists(file)) throw new Error(`File not found: ${file}`);
    return readFile(file);
  }

  return value;
}
