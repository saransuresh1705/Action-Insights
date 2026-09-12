export const OPERATION_KINDS = [
  "READ",
  "DRAFT",
  "WRITE",
  "SEND",
  "DELETE",
  "APPROVE",
  "MERGE",
  "TRANSITION",
  "INVITE",
  "RUN",
] as const;

export type OperationKind = (typeof OPERATION_KINDS)[number];

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly code: "allowed-read" | "allowed-draft" | "release-1-side-effect-denied";
  readonly reason: string;
}

export function evaluateOperation(kind: OperationKind): PolicyDecision {
  if (kind === "READ") {
    return { allowed: true, code: "allowed-read", reason: "Read-only operation is allowed." };
  }
  if (kind === "DRAFT") {
    return { allowed: true, code: "allowed-draft", reason: "Local draft generation is allowed." };
  }
  return {
    allowed: false,
    code: "release-1-side-effect-denied",
    reason: `${kind} operations are unavailable in release 1.`,
  };
}
