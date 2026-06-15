import type { MiddlewareHandler } from "hono";

export interface RequestLogEntry {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  error?: string;
}

export interface RequestLoggerOptions {
  /**
   * Include query strings in the logged path. Defaults to false because query
   * strings often carry user input or tokens.
   */
  includeSearch?: boolean;
  /**
   * Custom log writer. Defaults to `console.info(message)`.
   */
  logger?: (message: string, entry: RequestLogEntry) => void;
  /**
   * Custom formatter for the emitted message.
   */
  format?: (entry: RequestLogEntry) => string;
  /**
   * Test hook for deterministic duration assertions.
   */
  clock?: () => number;
}

export function requestLogger(
  options: RequestLoggerOptions = {},
): MiddlewareHandler {
  const includeSearch = options.includeSearch ?? false;
  const clock = options.clock ?? defaultClock;

  return async (c, next) => {
    const startedAt = clock();
    const request = c.req.raw;
    const path = getLogPath(request.url, includeSearch);

    try {
      await next();
      writeRequestLog(options, {
        method: request.method,
        path,
        status: c.res.status,
        durationMs: durationMs(startedAt, clock()),
      });
    } catch (error) {
      writeRequestLog(options, {
        method: request.method,
        path,
        status: 500,
        durationMs: durationMs(startedAt, clock()),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

function writeRequestLog(
  options: RequestLoggerOptions,
  entry: RequestLogEntry,
) {
  const message = (options.format ?? formatRequestLog)(entry);
  const logger = options.logger ?? ((text: string) => console.info(text));
  logger(message, entry);
}

function formatRequestLog(entry: RequestLogEntry): string {
  const error = entry.error ? ` error="${entry.error}"` : "";
  return `[evjs:server] ${entry.method} ${entry.path} ${entry.status} ${entry.durationMs}ms${error}`;
}

function getLogPath(url: string, includeSearch: boolean): string {
  try {
    const parsed = new URL(url);
    return includeSearch
      ? `${parsed.pathname}${parsed.search}`
      : parsed.pathname;
  } catch {
    return url;
  }
}

function durationMs(start: number, end: number): number {
  return Math.max(0, Math.round((end - start) * 100) / 100);
}

function defaultClock(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}
