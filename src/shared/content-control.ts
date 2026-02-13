export const CONTENT_CONTROL_MESSAGE_TYPE = 'LINGUARELAY_CONTENT_CONTROL' as const;

export type ContentControlAction = 'start' | 'stop' | 'status';

export interface ContentControlRequestMessage {
  type: typeof CONTENT_CONTROL_MESSAGE_TYPE;
  action: ContentControlAction;
}

export interface ContentControlResponseMessage {
  ok: boolean;
  running: boolean;
  adapterId?: string;
  message?: string;
}
