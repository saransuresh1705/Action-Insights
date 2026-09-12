import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { PublicConfiguration, ReasoningEffort } from "../shared/contracts.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const BACKFILL_OPTIONS = new Set([7, 30, 90, 180, 365]);

export interface AppConfiguration {
  readonly app: {
    readonly bindHost: string;
    readonly port: number;
    readonly timezone: string;
  };
  readonly scan: {
    readonly intervalMinutes: number;
    readonly initialBackfillDays: number;
    readonly overlapMinutes: number;
  };
  readonly retention: {
    readonly rawMessageDays: number;
    readonly derivedInsightDays: number;
    readonly auditMetadataDays: number;
  };
  readonly webex: {
    readonly oauthClientId: string;
    readonly credentialRef: string;
  };
  readonly model: {
    readonly provider: "openai";
    readonly name: "gpt-5.6-sol";
    readonly reasoningEffort: ReasoningEffort;
    readonly store: false;
    readonly credentialRef: string;
  };
}

export const DEFAULT_CONFIGURATION: AppConfiguration = {
  app: {
    bindHost: "127.0.0.1",
    port: 4318,
    timezone: "Asia/Kolkata",
  },
  scan: {
    intervalMinutes: 60,
    initialBackfillDays: 30,
    overlapMinutes: 10,
  },
  retention: {
    rawMessageDays: 30,
    derivedInsightDays: 90,
    auditMetadataDays: 180,
  },
  webex: {
    oauthClientId: "not-configured",
    credentialRef: "os-keychain://webex-action-insights/webex-oauth",
  },
  model: {
    provider: "openai",
    name: "gpt-5.6-sol",
    reasoningEffort: "medium",
    store: false,
    credentialRef: "os-keychain://webex-action-insights/openai",
  },
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function assertOnlyKeys(record: UnknownRecord, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unexpected.join(", ")}`);
  }
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function integerValue(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function credentialReference(value: unknown, label: string): string {
  const reference = stringValue(value, label);
  if (!reference.startsWith("os-keychain://") || reference.includes("@")) {
    throw new Error(`${label} must be an os-keychain reference and must not contain credentials`);
  }
  return reference;
}

export function validateConfiguration(value: unknown): AppConfiguration {
  const root = asRecord(value, "configuration");
  const app = asRecord(root.app, "app");
  const scan = asRecord(root.scan, "scan");
  const retention = asRecord(root.retention, "retention");
  const webex = asRecord(root.webex, "webex");
  const model = asRecord(root.model, "model");

  assertOnlyKeys(root, ["app", "scan", "retention", "webex", "model"], "configuration");
  assertOnlyKeys(app, ["bindHost", "port", "timezone"], "app");
  assertOnlyKeys(scan, ["intervalMinutes", "initialBackfillDays", "overlapMinutes"], "scan");
  assertOnlyKeys(retention, ["rawMessageDays", "derivedInsightDays", "auditMetadataDays"], "retention");
  assertOnlyKeys(webex, ["oauthClientId", "credentialRef"], "webex");
  assertOnlyKeys(model, ["provider", "name", "reasoningEffort", "store", "credentialRef"], "model");

  const bindHost = stringValue(app.bindHost, "app.bindHost");
  if (!LOOPBACK_HOSTS.has(bindHost)) {
    throw new Error("app.bindHost must be a loopback host");
  }

  const initialBackfillDays = integerValue(scan.initialBackfillDays, "scan.initialBackfillDays", 7, 365);
  if (!BACKFILL_OPTIONS.has(initialBackfillDays)) {
    throw new Error("scan.initialBackfillDays must be one of 7, 30, 90, 180, or 365");
  }

  if (model.provider !== "openai" || model.name !== "gpt-5.6-sol") {
    throw new Error("model provider and name must match the approved specification");
  }
  if (model.reasoningEffort !== "medium" && model.reasoningEffort !== "high") {
    throw new Error("model.reasoningEffort must be medium or high");
  }
  if (model.store !== false) {
    throw new Error("model.store must be false");
  }

  return {
    app: {
      bindHost,
      port: integerValue(app.port, "app.port", 1, 65_535),
      timezone: stringValue(app.timezone, "app.timezone"),
    },
    scan: {
      intervalMinutes: integerValue(scan.intervalMinutes, "scan.intervalMinutes", 5, 10_080),
      initialBackfillDays,
      overlapMinutes: integerValue(scan.overlapMinutes, "scan.overlapMinutes", 0, 60),
    },
    retention: {
      rawMessageDays: integerValue(retention.rawMessageDays, "retention.rawMessageDays", 1, 365),
      derivedInsightDays: integerValue(retention.derivedInsightDays, "retention.derivedInsightDays", 1, 730),
      auditMetadataDays: integerValue(retention.auditMetadataDays, "retention.auditMetadataDays", 1, 730),
    },
    webex: {
      oauthClientId: stringValue(webex.oauthClientId, "webex.oauthClientId"),
      credentialRef: credentialReference(webex.credentialRef, "webex.credentialRef"),
    },
    model: {
      provider: "openai",
      name: "gpt-5.6-sol",
      reasoningEffort: model.reasoningEffort,
      store: false,
      credentialRef: credentialReference(model.credentialRef, "model.credentialRef"),
    },
  };
}

export function defaultConfigurationPath(): string {
  return resolve(homedir(), ".config", "webex-action-insights", "config.json");
}

export async function loadConfiguration(path = defaultConfigurationPath()): Promise<AppConfiguration> {
  try {
    const contents = await readFile(path, "utf8");
    return validateConfiguration(JSON.parse(contents) as unknown);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_CONFIGURATION;
    }
    throw error;
  }
}

export function publicConfiguration(configuration: AppConfiguration): PublicConfiguration {
  return {
    timezone: configuration.app.timezone,
    scanIntervalMinutes: configuration.scan.intervalMinutes,
    initialBackfillDays: configuration.scan.initialBackfillDays,
    rawMessageRetentionDays: configuration.retention.rawMessageDays,
    derivedInsightRetentionDays: configuration.retention.derivedInsightDays,
    modelName: configuration.model.name,
    modelEnabled: false,
    directMessagesIncluded: true,
    backgroundServiceEnabled: false,
    externalWritesEnabled: false,
  };
}
