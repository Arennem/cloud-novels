import { randomUUID } from 'crypto';

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ date.getFullYear() }-${ pad(date.getMonth() + 1) }-${ pad(date.getDate()) } ${ pad(date.getHours()) }:${pad(date.getMinutes()) }:${pad(date.getSeconds()) }`;
}

export interface PaginatedList<T> {
  total: number;
  pageNum: number;
  pageSize: number;
  list: T[];
}

/** 默认分页：第 1 页，每页 10 条，最大 50 条 */
export const DEFAULT_PAGE_NUM = 1;
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;

export function paginated<T>(
  list: T[],
  total?: number,
  pageNum: number = DEFAULT_PAGE_NUM,
  pageSize: number = DEFAULT_PAGE_SIZE,
): PaginatedList<T> {
  const clampedSize = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
  const clampedPage = Math.max(1, pageNum);
  const start = (clampedPage - 1) * clampedSize;
  const sliced = list.slice(start, start + clampedSize);
  return { total: total ?? list.length, pageNum: clampedPage, pageSize: clampedSize, list: sliced };
}

export interface ApiResponse<T = unknown> {
  status: number;
  data: T | null;
  errorMsg: string | null;
  timestamp: string;
  traceId: string;
}

function genTraceId(): string {
  return randomUUID();
}

export function success<T>(data: T, traceId?: string): ApiResponse<T> {
  return {
    status: 0,
    data,
    errorMsg: null,
    timestamp: formatTimestamp(new Date()),
    traceId: traceId ?? genTraceId(),
  };
}

export function fail(errorMsg: string, status: number = 1, traceId?: string): ApiResponse<null> {
  return {
    status,
    data: null,
    errorMsg,
    timestamp: formatTimestamp(new Date()),
    traceId: traceId ?? genTraceId(),
  };
}
