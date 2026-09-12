const SAFE_FIELDS = new Set([
  "durationMs",
  "errorCode",
  "event",
  "httpStatus",
  "method",
  "policyCode",
  "requestId",
  "retryCount",
  "route",
  "scanIdHash",
  "spaceIdHash",
  "status",
  "version",
]);

const SAFE_EVENTS = new Set(["http_request", "http_request_failed", "service_started"]);

export type LogWriter = (line: string) => void;

export class SafeLogger {
  public constructor(private readonly writer: LogWriter = (line) => process.stdout.write(`${line}\n`)) {}

  public info(event: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.write("info", event, fields);
  }

  public error(event: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.write("error", event, fields);
  }

  private write(level: "info" | "error", event: string, fields: Readonly<Record<string, unknown>>): void {
    const safeEvent = SAFE_EVENTS.has(event) ? event : "unknown_event";
    const safe: Record<string, unknown> = { timestamp: new Date().toISOString(), level, event: safeEvent };
    for (const [key, value] of Object.entries(fields)) {
      if (SAFE_FIELDS.has(key) && isSafeValue(value)) {
        safe[key] = value;
      }
    }
    this.writer(JSON.stringify(safe));
  }
}

function isSafeValue(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}
