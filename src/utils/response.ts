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

export function paginated<T>(
  list: T[],
  total?: number,
  pageNum: number = 1,
  pageSize: number = list.length || 1,
): PaginatedList<T> {
  return { total: total ?? list.length, pageNum, pageSize, list };
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
