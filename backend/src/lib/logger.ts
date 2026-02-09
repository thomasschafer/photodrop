/**
 * Structured logging wrapper
 *
 * Outputs JSON-structured logs in production, readable console logs in dev.
 * Cloudflare Workers logs are captured via console.log/error automatically.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  return JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  });
}

export const logger = {
  debug(message: string, context?: LogContext) {
    console.log(formatLog('debug', message, context));
  },

  info(message: string, context?: LogContext) {
    console.log(formatLog('info', message, context));
  },

  warn(message: string, context?: LogContext) {
    console.warn(formatLog('warn', message, context));
  },

  error(message: string, context?: LogContext) {
    console.error(formatLog('error', message, context));
  },
};
