import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface DaemonProcess {
  pid: number;
  command: string;
}

export interface ProcessRow {
  pid: number;
  ppid: number;
  command: string;
}

export type RowsProvider = () => Promise<ProcessRow[]>;

export function daemonEntryPath(): string {
  return path.join(__dirname, 'daemonEntry.js');
}

export function parseProcessRows(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
  }
  return rows;
}

export function matchDaemonProcesses(rows: ProcessRow[], entryPath: string, excludePid: number): DaemonProcess[] {
  return rows
    .filter(row => row.pid !== excludePid)
    .filter(row => row.command.includes(entryPath))
    .map(row => ({ pid: row.pid, command: row.command }));
}

export function collectProcessTree(rows: ProcessRow[], rootPid: number): number[] {
  const children = new Map<number, number[]>();
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid)!.push(row.pid);
  }
  const tree: number[] = [];
  const queue = [rootPid];
  while (queue.length) {
    const pid = queue.shift()!;
    if (tree.includes(pid)) continue;
    tree.push(pid);
    for (const child of children.get(pid) ?? []) queue.push(child);
  }
  return tree;
}

export async function listProcessRows(): Promise<ProcessRow[]> {
  if (process.platform === 'win32')
    return listProcessRowsWindows();
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command=']);
  return parseProcessRows(stdout);
}

async function listProcessRowsWindows(): Promise<ProcessRow[]> {
  const script = 'Get-CimInstance Win32_Process | '
    + 'Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress';
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script]);
  const parsed = JSON.parse(stdout);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items
    .filter(item => item && item.ProcessId != null)
    .map(item => ({
      pid: Number(item.ProcessId),
      ppid: Number(item.ParentProcessId ?? 0),
      command: String(item.CommandLine ?? ''),
    }));
}

export async function findDaemonProcesses(
  rowsProvider: RowsProvider = listProcessRows,
  entryPath: string = daemonEntryPath()
): Promise<DaemonProcess[]> {
  return matchDaemonProcesses(await rowsProvider(), entryPath, process.pid);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function killProcessTree(rootPid: number, rowsProvider: RowsProvider = listProcessRows, timeoutMs = 3000): Promise<void> {
  const pids = collectProcessTree(await rowsProvider(), rootPid);
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && pids.some(pidAlive)) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const pid of pids) {
    if (pidAlive(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
}
