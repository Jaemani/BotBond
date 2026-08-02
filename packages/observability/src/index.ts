const SENSITIVE_KEY = /(authorization|token|secret|credential|private.?key|payment.?proof|bond.?proof|cookie)/i;
const REDACTED = "[REDACTED]";

export function redact(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redact(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

export interface StructuredLogger {
  info(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(write: (line: string) => void = console.log): StructuredLogger {
  const log = (level: "info" | "error", message: string, data?: Record<string, unknown>): void => {
    write(JSON.stringify({ level, message, ...(data ? { data: redact(data) } : {}) }));
  };
  return {
    info: (message, data) => log("info", message, data),
    error: (message, data) => log("error", message, data),
  };
}
