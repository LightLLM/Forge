export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

const SENSITIVE_KEY = /(api[_-]?key|authorization|password|secret|token)/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return value;
}

export class Logger {
  constructor(
    private readonly scope: string,
    private readonly minLevel: LogLevel = "info",
  ) {}

  child(scope: string): Logger {
    return new Logger(`${this.scope}:${scope}`, this.minLevel);
  }

  debug(message: string, fields?: LogFields): void {
    this.write("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.write("error", message, fields);
  }

  private write(level: LogLevel, message: string, fields?: LogFields): void {
    const order: LogLevel[] = ["debug", "info", "warn", "error"];
    if (order.indexOf(level) < order.indexOf(this.minLevel)) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      ...(fields ? { fields: redact(fields) } : {}),
    };
    const line = JSON.stringify(entry);
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

export const rootLogger = new Logger("forge");
