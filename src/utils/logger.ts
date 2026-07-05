import { config } from '../config.js';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

function shouldLog(level: keyof typeof LEVELS): boolean {
  return LEVELS[level] >= LEVELS[config.LOG_LEVEL];
}

function format(level: string, msg: string, meta?: unknown) {
  const ts = new Date().toISOString();
  const extra = meta !== undefined ? ` ${JSON.stringify(meta)}` : '';
  return `[${ts}] [${level.toUpperCase()}] ${msg}${extra}`;
}

export const logger = {
  debug(msg: string, meta?: unknown) {
    if (shouldLog('debug')) console.debug(format('debug', msg, meta));
  },
  info(msg: string, meta?: unknown) {
    if (shouldLog('info')) console.info(format('info', msg, meta));
  },
  warn(msg: string, meta?: unknown) {
    if (shouldLog('warn')) console.warn(format('warn', msg, meta));
  },
  error(msg: string, meta?: unknown) {
    if (shouldLog('error')) console.error(format('error', msg, meta));
  },
};
