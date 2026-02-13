export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const currentLevel: LogLevel = 'info';

function shouldLog(level: LogLevel): boolean {
  return levelWeight[level] >= levelWeight[currentLevel];
}

export function log(level: LogLevel, scope: string, message: string, data?: unknown): void {
  if (!shouldLog(level)) {
    return;
  }

  const prefix = `[linguarelay][${scope}]`;
  if (level === 'error') {
    console.error(prefix, message, data ?? '');
    return;
  }
  if (level === 'warn') {
    console.warn(prefix, message, data ?? '');
    return;
  }
  if (level === 'debug') {
    console.debug(prefix, message, data ?? '');
    return;
  }
  console.info(prefix, message, data ?? '');
}

