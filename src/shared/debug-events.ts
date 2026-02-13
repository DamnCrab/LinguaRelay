export type DebugEventLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DebugEventInput {
  source: 'popup' | 'content' | 'background' | 'session' | 'engine';
  level: DebugEventLevel;
  scope: string;
  message: string;
  details?: string;
  sessionId?: string;
  tabId?: number;
  frameId?: number;
  url?: string;
}

export interface DebugEventRecord extends DebugEventInput {
  id: string;
  timestamp: number;
}

export interface DebugState {
  enabled: boolean;
}
