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
  "spacesTotal",
  "spacesCompleted",
  "spacesFailed",
  "messagesIngested",
]);

const SAFE_EVENTS = new Set([
  "http_request",
  "http_request_failed",
  "scan_started",
  "scan_completed",
  "scan_failed",
  "service_started",
]);

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
      if (SAFE_FIELDS.has(key) && isSafeFieldValue(key, value)) {
        safe[key] = value;
      }
    }
    this.writer(JSON.stringify(safe));
  }
}

function isSafeFieldValue(key: string, value: unknown): value is string | number | boolean | null {
  if (["durationMs", "httpStatus", "messagesIngested", "retryCount", "spacesCompleted", "spacesFailed", "spacesTotal"].includes(key)) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }
  if (key === "method") return value === "GET" || value === "POST";
  if (key === "status") {
    return ["ready", "running", "complete", "partial", "cancelled", "ok", "error"].includes(String(value));
  }
  if (key === "route") {
    return typeof value === "string" && /^\/[a-z0-9/:._-]{0,120}$/u.test(value);
  }
  if (key === "requestId" || key === "scanIdHash" || key === "spaceIdHash") {
    return typeof value === "string" && /^[a-f0-9]{8,128}$/u.test(value);
  }
  if (key === "errorCode" || key === "policyCode" || key === "version") {
    return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(value);
  }
  return typeof value === "boolean" || value === null;
}
