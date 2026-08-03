// Mirrors docs/03-contracts.md. Do not add fields here without a CCR.

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

export type BotBondEvent = {
  eventId: string;
  sessionId: string;
  occurredAt: string;
  type: BotBondEventType;
  data: Record<string, unknown>;
  traceId: string;
};

export type Fixture = {
  fixtureVersion: string;
  name: string;
  title: string;
  summary: string;
  expectedOutcome: Record<string, string>;
  /** Fixture-only narration. It never participates in access decisions. */
  story?: DemoStory;
  sessionId: string;
  policyHash: string;
  events: BotBondEvent[];
};

export type DemoStory = {
  question: string;
  merchantOutcome: string;
  beats: Array<{
    eventType: BotBondEventType;
    title: string;
    detail: string;
  }>;
};

export type TxStatus = "PENDING" | "CONFIRMED" | "FAILED";

export type ChainTx = {
  label: string;
  signature: string;
  status: TxStatus;
  cluster: string;
  slot?: number;
  explorerEligible: boolean;
};

export type AllowedOperation = {
  method: string;
  pathTemplate: string;
  allowedResponseFields: string[];
  maxCalls: number;
};

export type Policy = {
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
};

export type TraceRow = {
  id: string;
  kind: "ALLOWED" | "DENIED" | "RESERVATION" | "SETTLEMENT";
  method?: string;
  path?: string;
  headline: string;
  detail?: string;
  bondUnchanged: boolean;
  at: string;
};

/** Session lifecycle from docs/02-architecture.md §5. */
export type SessionState =
  | "CREATED"
  | "POLICY_READY"
  | "PAYMENT_READY"
  | "BONDED"
  | "ACTIVE"
  | "CLOSED"
  | "VIOLATED"
  | "EXPIRED";

export type ViewState = {
  sessionState: SessionState;
  /** panel 1 */
  task: string | null;
  taskEn: string | null;
  /** panel 2 */
  policy: Policy | null;
  policyHash: string | null;
  excluded: Array<{ path: string; reason: string }>;
  explanation: string[];
  compilerMeta: { model: string; latencyMs: number; repairAttempts: number } | null;
  /** panel 3 — usage is spent and gone */
  usageSpentAtomic: number;
  usageCapAtomic: number;
  usageSettled: boolean;
  paymentMode: string | null;
  /** panel 3 — bond is locked and returns */
  bondAmountAtomic: number;
  maxPenaltyAtomic: number;
  penaltyAtomic: number;
  bondRefundedAtomic: number;
  bondPhase: "NONE" | "LOCKED" | "SETTLING" | "RETURNED";
  fixtureMode: boolean;
  /** reservation */
  reservation: {
    id: string;
    productId: string;
    ttlSeconds: number;
    expiresAt: string | null;
    secondsRemaining: number | null;
    status: "HELD" | "RELEASED" | "CONSUMED" | "EXPIRED";
  } | null;
  /** panel 4 */
  trace: TraceRow[];
  txs: ChainTx[];
  deniedCount: number;
  callCount: number;
  receiptHash: string | null;
  outcome: string | null;
  /** the moment we most want judges to notice */
  lastBondDeltaWasZeroOnDenial: boolean;
};
