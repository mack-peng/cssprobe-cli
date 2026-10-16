import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function saveScreenshotFile(dataUrl: string, out?: string): string {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  const resolvedOut = out
    ? path.resolve(out)
    : (() => {
        const dir = path.join(os.homedir(), '.cssprobe-cli', 'screenshots');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        return path.join(dir, `screenshot-${ts}.png`);
      })();
  const dir = path.dirname(resolvedOut);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolvedOut, buffer);
  return resolvedOut;
}
