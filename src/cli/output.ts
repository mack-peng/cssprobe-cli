export interface Output {
  readonly json: boolean;
  readonly raw: boolean;
  format(data: any): string;
  error(message: string): never;
  help(text: string): void;
  version(version: string): void;
}

export class TextOutput implements Output {
  readonly json = false;
  readonly raw: boolean;

  constructor(raw = false) {
    this.raw = raw;
  }

  format(data: any): string {
    if (this.raw)
      return typeof data === 'string' ? data : JSON.stringify(data);
    if (data === null || data === undefined)
      return '(empty)';
    if (Array.isArray(data))
      return this._formatTable(data);
    if (typeof data === 'object')
      return JSON.stringify(data, null, 2);
    return String(data);
  }

  private _formatTable(rows: Record<string, any>[]): string {
    if (rows.length === 0)
      return '(empty list)';
    const allColumns = Object.keys(rows[0] || {});
    const columns = allColumns.filter(col => {
      const val = rows[0][col];
      return val === null || val === undefined || typeof val !== 'object';
    });
    if (columns.length === 0)
      return JSON.stringify(rows, null, 2);
    const cells = rows.map((item: any) => columns.map((col) => {
      const v = item[col];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    }));
    cells.unshift(columns);
    const widths = columns.map((_, ci) => Math.max(...cells.map((r) => String(r[ci]).length)));
    return cells
      .map((row, ri) => {
        const line = row.map((cell, ci) => String(cell).padEnd(widths[ci])).join('  ');
        if (ri === 0) return line + '\n' + widths.map((w) => '-'.repeat(w)).join('  ');
        return line;
      })
      .join('\n');
  }

  error(message: string): never {
    console.error(`Error: ${message}`);
    process.exit(1);
  }

  help(text: string): void {
    console.log(text);
  }

  version(version: string): void {
    console.log(version);
  }
}

export class JsonOutput implements Output {
  readonly json = true;
  readonly raw = false;

  format(data: any): string {
    return JSON.stringify(data, null, 2);
  }

  error(message: string): never {
    console.log(JSON.stringify({ isError: true, error: message }));
    process.exit(1);
  }

  help(text: string): void {
    console.log(JSON.stringify({ help: text }));
  }

  version(version: string): void {
    console.log(JSON.stringify({ version }));
  }
}
