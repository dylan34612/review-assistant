export type LogLevel = "info" | "warn" | "error";
export type LogEntry = { level: LogLevel; message: string; details?: Record<string, unknown> };
export type LogFn = (level: LogLevel, message: string, details?: Record<string, unknown>) => void;

export function createLogCollector(): { log: LogFn; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const log: LogFn = (level, message, details) => {
    console.log(`[parser:${level}] ${message}`, details ?? "");
    entries.push({ level, message, details });
  };
  return { log, entries };
}
