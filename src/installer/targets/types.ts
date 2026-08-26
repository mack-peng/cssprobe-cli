export type Location = 'global' | 'local';

export type TargetId = 'claude' | 'opencode' | 'cursor' | 'codex' | 'hermes' | 'gemini';

export interface WriteResult {
  files: Array<{
    path: string;
    action: 'created' | 'updated' | 'removed' | 'not-found' | 'kept';
  }>;
  notes?: string[];
}

export interface AgentTarget {
  readonly id: TargetId;
  readonly displayName: string;
  /** Per-agent skill directory path (null if no skill concept). */
  skillDir(loc: Location): string | null;
  /** Check if this agent's skill directory already has our skill installed. */
  detect(loc: Location): { installed: boolean; alreadyConfigured: boolean };
  install(loc: Location): WriteResult;
  uninstall(loc: Location): WriteResult;
}
