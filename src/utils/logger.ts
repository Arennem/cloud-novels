import { resolve } from 'path';
import { mkdirSync, existsSync } from 'fs';
import winston from 'winston';
import { config } from '../config.js';

const logDir = resolve(config.OUTPUT_DIR, 'logs');
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

// 日志级别映射：debug=0 ... error=3
const levelMap: Record<string, string> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

const winstonLogger = winston.createLogger({
  level: levelMap[config.LOG_LEVEL] ?? 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const extra = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
      return `[${timestamp}] [${level.toUpperCase()}] ${message}${extra}`;
    }),
  ),
  transports: [
    // 所有级别写入 combined 日志
    new winston.transports.File({
      filename: resolve(logDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    // 错误级别单独写入 error 日志
    new winston.transports.File({
      filename: resolve(logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

// 开发环境也输出到 console
if (process.env.NODE_ENV !== 'production') {
  winstonLogger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const extra = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] [${level}] ${message}${extra}`;
      }),
    ),
  }));
}

export const logger = {
  debug(msg: string, meta?: unknown) {
    winstonLogger.debug(msg, meta ?? {});
  },
  info(msg: string, meta?: unknown) {
    winstonLogger.info(msg, meta ?? {});
  },
  warn(msg: string, meta?: unknown) {
    winstonLogger.warn(msg, meta ?? {});
  },
  error(msg: string, meta?: unknown) {
    winstonLogger.error(msg, meta ?? {});
  },
};
