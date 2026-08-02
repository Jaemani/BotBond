import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv2020Import, { type ErrorObject } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";

export type HttpMethod = "GET" | "POST";

export interface AllowedOperation {
  method: HttpMethod;
  pathTemplate: string;
  allowedResponseFields: string[];
  maxCalls: number;
}

export interface AccessPolicy {
  version: "botbond-policy/v1";
  policyId: string;
  merchantId: string;
  agentWallet: string;
  purpose: string;
  allowedOperations: AllowedOperation[];
  constraints: {
    maxTotalCalls: number;
    maxRequestsPerMinute: number;
    expiresAt: string;
    usageCapAtomic: string;
    bondAmountAtomic: string;
    maxPenaltyAtomic: string;
  };
  bondedActions: Array<{
    operationId: string;
    maxActive: number;
    ttlSeconds: number;
    expiryPenaltyAtomic: string;
  }>;
  settlement: {
    validClose: "REFUND_BOND";
    scopeViolation: "BOUNDED_PENALTY_AND_REFUND_REMAINDER";
    expiry: "RECLAIM_AFTER_GRACE_PERIOD";
  };
  catalogVersion: string;
}

export interface CatalogOperation {
  id: string;
  method: HttpMethod;
  pathTemplate: string;
  fields: string[];
  maxCalls: number;
  riskTier: "LOW" | "BONDED";
}

export interface MerchantCapabilityCatalog {
  version: "merchant-catalog/v1";
  merchantId: string;
  maxTotalCalls?: number;
  maxRequestsPerMinute?: number;
  maxSessionTtlSeconds?: number;
  maxUsageCapAtomic?: string;
  maxBondAmountAtomic?: string;
  maxPenaltyAtomic?: string;
  defaultExpiryPenaltyAtomic?: string;
  operations: CatalogOperation[];
  forbiddenPaths: string[];
}

export type SessionState =
  | "CREATED"
  | "POLICY_READY"
  | "PAYMENT_READY"
  | "BONDED"
  | "ACTIVE"
  | "CLOSED"
  | "VIOLATED"
  | "EXPIRED";

export type ReservationState = "ACTIVE" | "RELEASED" | "CONSUMED" | "EXPIRED";

export type BotBondEventType =
  | "INTENT_RECEIVED"
  | "POLICY_COMPILED"
  | "PAYMENT_VERIFIED"
  | "BOND_OPENED"
  | "SESSION_ACTIVATED"
  | "REQUEST_ALLOWED"
  | "REQUEST_DENIED"
  | "RESERVATION_CREATED"
  | "RESERVATION_RELEASED"
  | "RESERVATION_CONSUMED"
  | "RESERVATION_EXPIRED"
  | "USAGE_SETTLED"
  | "BOND_REFUNDED"
  | "PENALTY_SETTLED"
  | "SESSION_CLOSED";

export interface BotBondEvent {
  eventId: string;
  sessionId: string;
  occurredAt: string;
  type: BotBondEventType;
  data: Record<string, unknown>;
  traceId: string;
}

export type AdapterStatus = "PENDING" | "CONFIRMED" | "FAILED";
export interface AdapterResult {
  status: AdapterStatus;
  retryable: boolean;
  providerReference?: string;
  failureCode?: string;
  fixtureMarker?: "FAKE_ADAPTER_FIXTURE";
}
export interface PaymentChallengeResult extends AdapterResult {
  challenge?: string;
}
export interface PaymentVerificationResult extends AdapterResult {
  usageLimitAtomic?: string;
}
export interface UsageSettlementResult extends AdapterResult {
  usageChargedAtomic?: string;
}
export interface BondVerificationResult extends AdapterResult {
  bondAmountAtomic?: string;
  maxPenaltyAtomic?: string;
}
export interface BondSettlementResult extends AdapterResult {
  bondRefundedAtomic?: string;
  penaltyAtomic?: string;
}

export interface SettlementReceipt {
  sessionId: string;
  outcome: "CLOSED" | "VIOLATED" | "EXPIRED";
  policyHash: string;
  calls: number;
  usageChargedAtomic: string;
  bondRefundedAtomic: string;
  penaltyAtomic: string;
  transactions: Array<{
    kind: "PAYMENT" | "BOND";
    status: AdapterStatus;
    providerReference?: string;
    fixtureMarker?: "FAKE_ADAPTER_FIXTURE";
  }>;
  receiptHash: string;
}

export interface PaymentAdapter {
  createChallenge(input: { sessionId: string; usageCapAtomic: string }): Promise<PaymentChallengeResult>;
  verifyCredential(input: { sessionId: string; credential: string; challenge?: string }): Promise<PaymentVerificationResult>;
  getUsageSettlement(input: { sessionId: string; calls: number; usageCapAtomic: string }): Promise<UsageSettlementResult>;
}

export interface SettlementAuthorizationEvidence {
  version: "botbond-settlement-evidence/v1";
  sessionId: string;
  policyHash: string;
  reservationId?: string;
  outcome: "VALID_CLOSE" | "EXPIRED_RESERVATION";
  usageChargedAtomic: string;
  penaltyAtomic: string;
  bondRefundedAtomic: string;
  nonce: string;
  issuedAt: string;
  authority: string;
  evidenceHash: string;
  signature: string;
}

export interface BondAdapter {
  verifyOpenBond(input: { sessionId: string; bondAccount: string; policyHash: string; amountAtomic: string; maxPenaltyAtomic: string }): Promise<BondVerificationResult>;
  requestValidClose(input: { sessionId: string; policyHash: string; amountAtomic: string; evidence?: SettlementAuthorizationEvidence }): Promise<BondSettlementResult>;
  requestExpiredReservationSettlement(input: { sessionId: string; policyHash: string; penaltyAtomic: string; maxPenaltyAtomic: string; bondAmountAtomic: string; reservationId: string; evidence?: SettlementAuthorizationEvidence }): Promise<BondSettlementResult>;
  getTransactionStatus(input: { providerReference: string }): Promise<AdapterResult>;
}

const Ajv2020 = Ajv2020Import as unknown as new (options: object) => import("ajv").default;
const addFormats = addFormatsImport as unknown as (ajv: import("ajv").default) => import("ajv").default;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const loadSchema = (name: string): object =>
  JSON.parse(readFileSync(new URL(`../schemas/${name}`, import.meta.url), "utf8")) as object;

const accessPolicyValidator = ajv.compile<AccessPolicy>(loadSchema("access-policy.schema.json"));
const catalogValidator = ajv.compile<MerchantCapabilityCatalog>(loadSchema("merchant-catalog.schema.json"));
const eventValidator = ajv.compile<BotBondEvent>(loadSchema("botbond-event.schema.json"));
const receiptValidator = ajv.compile<SettlementReceipt>(loadSchema("settlement-receipt.schema.json"));

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const formatErrors = (errors: ErrorObject[] | null | undefined): string[] =>
  (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`);

export function validateCatalog(value: unknown): ValidationResult {
  const valid = catalogValidator(value);
  return { valid, errors: valid ? [] : formatErrors(catalogValidator.errors) };
}

export function validateEvent(value: unknown): ValidationResult {
  const valid = eventValidator(value);
  return { valid, errors: valid ? [] : formatErrors(eventValidator.errors) };
}

export function validateReceipt(value: unknown): ValidationResult {
  const valid = receiptValidator(value);
  return { valid, errors: valid ? [] : formatErrors(receiptValidator.errors) };
}

export function validateAccessPolicy(value: unknown, catalog?: MerchantCapabilityCatalog): ValidationResult {
  if (!accessPolicyValidator(value)) {
    return { valid: false, errors: formatErrors(accessPolicyValidator.errors) };
  }
  const policy = value as AccessPolicy;
  if (!catalog) return { valid: true, errors: [] };

  const errors: string[] = [];
  if (policy.merchantId !== catalog.merchantId) errors.push("merchantId is outside catalog");
  if (policy.catalogVersion !== catalog.version) errors.push("catalogVersion does not match catalog");
  const totalOperationCalls = policy.allowedOperations.reduce((sum, operation) => sum + operation.maxCalls, 0);
  if (policy.constraints.maxTotalCalls > totalOperationCalls) errors.push("maxTotalCalls exceeds allowed operation calls");
  if (catalog.maxTotalCalls !== undefined && policy.constraints.maxTotalCalls > catalog.maxTotalCalls) errors.push("maxTotalCalls exceeds catalog maximum");
  if (catalog.maxRequestsPerMinute !== undefined && policy.constraints.maxRequestsPerMinute > catalog.maxRequestsPerMinute) errors.push("maxRequestsPerMinute exceeds catalog maximum");
  if (catalog.maxUsageCapAtomic !== undefined && BigInt(policy.constraints.usageCapAtomic) > BigInt(catalog.maxUsageCapAtomic)) errors.push("usageCapAtomic exceeds catalog maximum");
  if (catalog.maxBondAmountAtomic !== undefined && BigInt(policy.constraints.bondAmountAtomic) > BigInt(catalog.maxBondAmountAtomic)) errors.push("bondAmountAtomic exceeds catalog maximum");
  if (catalog.maxPenaltyAtomic !== undefined && BigInt(policy.constraints.maxPenaltyAtomic) > BigInt(catalog.maxPenaltyAtomic)) errors.push("maxPenaltyAtomic exceeds catalog maximum");
  for (const operation of policy.allowedOperations) {
    const capability = catalog.operations.find(
      (entry) => entry.method === operation.method && entry.pathTemplate === operation.pathTemplate,
    );
    if (!capability) {
      errors.push(`${operation.method} ${operation.pathTemplate} is outside catalog`);
      continue;
    }
    if (operation.maxCalls > capability.maxCalls) errors.push(`${capability.id} maxCalls exceeds catalog`);
    for (const field of operation.allowedResponseFields) {
      if (!capability.fields.includes(field)) errors.push(`${capability.id} field ${field} is outside catalog`);
    }
  }
  for (const action of policy.bondedActions) {
    const capability = catalog.operations.find((entry) => entry.id === action.operationId);
    if (!capability || capability.riskTier !== "BONDED") errors.push(`${action.operationId} is not a bonded catalog capability`);
    const selected = policy.allowedOperations.some((entry) => capability && entry.method === capability.method && entry.pathTemplate === capability.pathTemplate);
    if (!selected) errors.push(`${action.operationId} bonded action is not selected in allowed operations`);
  }
  if (BigInt(policy.constraints.maxPenaltyAtomic) > BigInt(policy.constraints.bondAmountAtomic)) {
    errors.push("maxPenaltyAtomic exceeds bondAmountAtomic");
  }
  for (const action of policy.bondedActions) {
    if (BigInt(action.expiryPenaltyAtomic) > BigInt(policy.constraints.maxPenaltyAtomic)) {
      errors.push(`${action.operationId} expiry penalty exceeds policy maximum`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => {
        if (record[key] === undefined) throw new TypeError("Canonical JSON rejects undefined values");
        return `${JSON.stringify(key)}:${canonicalize(record[key])}`;
      })
      .join(",")}}`;
  }
  throw new TypeError(`Canonical JSON rejects ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

export function sha256Hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function policyHash(policy: AccessPolicy): string {
  return sha256Hash(policy);
}

export * from "./adapter-contract.js";
