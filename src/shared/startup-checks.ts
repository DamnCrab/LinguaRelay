import type { AsrMode } from './contracts';

export type StartupCheckIssueLevel = 'error' | 'warning';

export interface StartupCheckIssue {
  code: string;
  level: StartupCheckIssueLevel;
  message: string;
}

export interface StartupCheckResult {
  ok: boolean;
  checkedAt: number;
  asrMode: AsrMode;
  modelId?: string;
  issues: StartupCheckIssue[];
}
