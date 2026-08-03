import type {
  AccessPolicy,
  AdapterStatus,
  BotBondEvent,
  ReservationState,
  SessionState,
  SettlementAuthorizationEvidence,
  SettlementReceipt,
} from "@botbond/contracts";

export interface IntentRecord {
  intentId: string;
  policy: AccessPolicy;
  policyHash: string;
  explanation: string[];
  excludedPermissions: string[];
  fixtureMarker?: "FAKE_COMPILER_FIXTURE";
}

export interface InventoryRecord {
  productId: string;
  stock: number;
  updatedAt: string;
}

export interface ReservationRecord {
  reservationId: string;
  sessionId: string;
  productId: string;
  quantity: number;
  createdAt: string;
  expiresAt: string;
  state: ReservationState;
  settlementRequested: boolean;
}

export interface SettlementAttemptRecord {
  attemptId: string;
  sessionId: string;
  outcome: "VALID_CLOSE" | "EXPIRED_RESERVATION";
  reservationId?: string;
  evidence: SettlementAuthorizationEvidence;
  status: AdapterStatus;
  retryable: boolean;
  providerReference?: string;
  failureCode?: string;
  startedAt: string;
  updatedAt: string;
}

export function mergeSettlementAttempt(
  current: SettlementAttemptRecord,
  incoming: SettlementAttemptRecord,
): SettlementAttemptRecord {
  if (current.evidence.evidenceHash !== incoming.evidence.evidenceHash) {
    throw new Error("SETTLEMENT_EVIDENCE_CONFLICT");
  }
  if (
    current.providerReference
    && incoming.providerReference
    && current.providerReference !== incoming.providerReference
  ) {
    throw new Error("SETTLEMENT_PROVIDER_REFERENCE_CONFLICT");
  }

  if (current.status === "CONFIRMED") {
    return structuredClone(current);
  }

  const statusRank: Record<AdapterStatus, number> = {
    PENDING: 0,
    FAILED: 1,
    CONFIRMED: 2,
  };
  if (statusRank[incoming.status] < statusRank[current.status]) {
    return structuredClone(current);
  }

  const providerReference = current.providerReference ?? incoming.providerReference;
  const { failureCode: _failureCode, providerReference: _providerReference, ...identity } = current;
  return {
    ...identity,
    status: incoming.status,
    retryable: incoming.retryable,
    ...(providerReference ? { providerReference } : {}),
    ...(incoming.status !== "CONFIRMED" && incoming.failureCode
      ? { failureCode: incoming.failureCode }
      : {}),
    updatedAt: incoming.updatedAt,
  };
}

export interface SessionRecord {
  sessionId: string;
  intentId: string;
  policy: AccessPolicy;
  policyHash: string;
  state: SessionState;
  tokenHash?: string;
  expiresAt: string;
  calls: number;
  operationCalls: Record<string, number>;
  requestTimestamps: number[];
  traceId: string;
  paymentReference?: string;
  bondReference?: string;
  settlementLeaseExpiresAt?: string;
  receipt?: SettlementReceipt;
}

export type IdempotencyClaim =
  | { status: "CLAIMED" }
  | { status: "IN_PROGRESS" }
  | { status: "COMPLETED"; value: unknown }
  | { status: "CONFLICT" };

export interface Repository {
  saveIntent(intent: IntentRecord): Promise<void>;
  getIntent(intentId: string): Promise<IntentRecord | undefined>;
  saveSession(session: SessionRecord): Promise<void>;
  createSession(session: SessionRecord): Promise<boolean>;
  deleteSessionIfState(sessionId: string, allowedStates: SessionState[]): Promise<boolean>;
  getSession(sessionId: string): Promise<SessionRecord | undefined>;
  listSessions(): Promise<SessionRecord[]>;
  transitionSession(sessionId: string, expected: SessionState, next: SessionState): Promise<SessionRecord>;
  claimSettlement(sessionId: string, now: Date, leaseMs: number): Promise<SessionRecord | undefined>;
  reserveRequest(sessionId: string, input: { operationKey: string; operationMaxCalls: number; maxTotalCalls: number; maxRequestsPerMinute: number; nowMs: number; expectedState: "ACTIVE" | "SETTLING" }): Promise<SessionRecord>;
  appendEvent(event: BotBondEvent): Promise<void>;
  listEvents(sessionId: string): Promise<BotBondEvent[]>;
  saveReservation(reservation: ReservationRecord): Promise<void>;
  getReservation(reservationId: string): Promise<ReservationRecord | undefined>;
  listReservations(sessionId: string): Promise<ReservationRecord[]>;
  createSettlementAttempt(attempt: SettlementAttemptRecord): Promise<SettlementAttemptRecord>;
  claimSettlementNonce(nonce: string, evidenceHash: string): Promise<boolean>;
  saveSettlementAttempt(attempt: SettlementAttemptRecord): Promise<SettlementAttemptRecord>;
  getSettlementAttempt(attemptId: string): Promise<SettlementAttemptRecord | undefined>;
  listSettlementAttempts(sessionId?: string): Promise<SettlementAttemptRecord[]>;
  getInventory(productId: string): Promise<InventoryRecord | undefined>;
  putInventoryIfAbsent(inventory: InventoryRecord): Promise<InventoryRecord>;
  createReservationWithInventory(reservation: ReservationRecord): Promise<void>;
  finalizeReservationWithInventory(sessionId: string, reservationId: string, state: Exclude<ReservationState, "ACTIVE">, nowMs: number): Promise<{ reservation: ReservationRecord; changed: boolean }>;
  getIdempotent(scope: string, key: string): Promise<unknown | undefined>;
  putIdempotent(scope: string, key: string, value: unknown): Promise<void>;
  claimIdempotent(scope: string, key: string, fingerprint: string): Promise<IdempotencyClaim>;
  completeIdempotent(scope: string, key: string, fingerprint: string, value: unknown): Promise<void>;
  releaseIdempotent(scope: string, key: string, fingerprint: string): Promise<void>;
}

export class InMemoryRepository implements Repository {
  private readonly intents = new Map<string, IntentRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly events = new Map<string, BotBondEvent[]>();
  private readonly reservations = new Map<string, ReservationRecord>();
  private readonly settlementAttempts = new Map<string, SettlementAttemptRecord>();
  private readonly settlementNonceClaims = new Map<string, string>();
  private readonly inventory = new Map<string, InventoryRecord>();
  private readonly idempotency = new Map<string, { fingerprint: string; status: "IN_PROGRESS" | "COMPLETED"; value?: unknown }>();

  async saveIntent(intent: IntentRecord): Promise<void> {
    this.intents.set(intent.intentId, structuredClone(intent));
  }
  async getIntent(intentId: string): Promise<IntentRecord | undefined> {
    const intent = this.intents.get(intentId);
    return intent ? structuredClone(intent) : undefined;
  }
  async saveSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.sessionId, structuredClone(session));
  }
  async createSession(session: SessionRecord): Promise<boolean> {
    if (this.sessions.has(session.sessionId)) return false;
    this.sessions.set(session.sessionId, structuredClone(session));
    return true;
  }
  async deleteSessionIfState(sessionId: string, allowedStates: SessionState[]): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || !allowedStates.includes(session.state)) return false;
    this.sessions.delete(sessionId);
    this.events.delete(sessionId);
    return true;
  }
  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const session = this.sessions.get(sessionId);
    return session ? structuredClone(session) : undefined;
  }
  async listSessions(): Promise<SessionRecord[]> {
    return [...this.sessions.values()].map((session) => structuredClone(session));
  }
  async transitionSession(sessionId: string, expected: SessionState, next: SessionState): Promise<SessionRecord> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    const allowed: Record<SessionState, SessionState[]> = {
      CREATED: ["POLICY_READY"],
      POLICY_READY: ["PAYMENT_READY"],
      PAYMENT_READY: ["ACTIVE", "BONDED"],
      BONDED: ["ACTIVE"],
      ACTIVE: ["SETTLING"],
      SETTLING: ["ACTIVE", "CLOSED", "VIOLATED", "EXPIRED"],
      CLOSED: [],
      VIOLATED: [],
      EXPIRED: [],
    };
    if (session.state !== expected || !(allowed[expected] ?? []).includes(next)) {
      throw new Error(`INVALID_STATE_TRANSITION:${session.state}->${next}`);
    }
    const { settlementLeaseExpiresAt: _settlementLeaseExpiresAt, ...current } = session;
    const updated: SessionRecord = { ...current, state: next };
    this.sessions.set(sessionId, structuredClone(updated));
    return structuredClone(updated);
  }
  async claimSettlement(sessionId: string, now: Date, leaseMs: number): Promise<SessionRecord | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    const leaseExpiresAt = session.settlementLeaseExpiresAt
      ? new Date(session.settlementLeaseExpiresAt).getTime()
      : Number.NEGATIVE_INFINITY;
    if (session.state !== "ACTIVE" && (session.state !== "SETTLING" || leaseExpiresAt > now.getTime())) {
      return undefined;
    }
    const updated: SessionRecord = {
      ...session,
      state: "SETTLING",
      settlementLeaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    };
    this.sessions.set(sessionId, structuredClone(updated));
    return structuredClone(updated);
  }
  async reserveRequest(sessionId: string, input: { operationKey: string; operationMaxCalls: number; maxTotalCalls: number; maxRequestsPerMinute: number; nowMs: number; expectedState: "ACTIVE" | "SETTLING" }): Promise<SessionRecord> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    if (session.state !== input.expectedState) throw new Error("SESSION_NOT_ACTIVE");
    const timestamps = session.requestTimestamps.filter((timestamp) => timestamp > input.nowMs - 60_000);
    if ((session.operationCalls[input.operationKey] ?? 0) >= input.operationMaxCalls) throw new Error("OPERATION_CALL_LIMIT");
    if (session.calls >= input.maxTotalCalls) throw new Error("TOTAL_CALL_LIMIT");
    if (timestamps.length >= input.maxRequestsPerMinute) throw new Error("RATE_LIMIT");
    session.calls += 1;
    session.operationCalls[input.operationKey] = (session.operationCalls[input.operationKey] ?? 0) + 1;
    session.requestTimestamps = [...timestamps, input.nowMs];
    this.sessions.set(sessionId, structuredClone(session));
    return structuredClone(session);
  }
  async appendEvent(event: BotBondEvent): Promise<void> {
    const existing = this.events.get(event.sessionId) ?? [];
    existing.push(structuredClone(event));
    this.events.set(event.sessionId, existing);
  }
  async listEvents(sessionId: string): Promise<BotBondEvent[]> {
    return structuredClone(this.events.get(sessionId) ?? []);
  }
  async saveReservation(reservation: ReservationRecord): Promise<void> {
    this.reservations.set(reservation.reservationId, structuredClone(reservation));
  }
  async getReservation(reservationId: string): Promise<ReservationRecord | undefined> {
    const reservation = this.reservations.get(reservationId);
    return reservation ? structuredClone(reservation) : undefined;
  }
  async listReservations(sessionId: string): Promise<ReservationRecord[]> {
    return [...this.reservations.values()].filter((record) => record.sessionId === sessionId).map((record) => structuredClone(record));
  }
  async createSettlementAttempt(attempt: SettlementAttemptRecord): Promise<SettlementAttemptRecord> {
    const existing = this.settlementAttempts.get(attempt.attemptId);
    if (existing) return structuredClone(existing);
    this.settlementAttempts.set(attempt.attemptId, structuredClone(attempt));
    return structuredClone(attempt);
  }
  async claimSettlementNonce(nonce: string, evidenceHash: string): Promise<boolean> {
    const existing = this.settlementNonceClaims.get(nonce);
    if (existing !== undefined) return existing === evidenceHash;
    this.settlementNonceClaims.set(nonce, evidenceHash);
    return true;
  }
  async saveSettlementAttempt(attempt: SettlementAttemptRecord): Promise<SettlementAttemptRecord> {
    const current = this.settlementAttempts.get(attempt.attemptId);
    if (!current) throw new Error("SETTLEMENT_ATTEMPT_NOT_FOUND");
    const merged = mergeSettlementAttempt(current, attempt);
    this.settlementAttempts.set(attempt.attemptId, structuredClone(merged));
    return structuredClone(merged);
  }
  async getSettlementAttempt(attemptId: string): Promise<SettlementAttemptRecord | undefined> {
    const attempt = this.settlementAttempts.get(attemptId);
    return attempt ? structuredClone(attempt) : undefined;
  }
  async listSettlementAttempts(sessionId?: string): Promise<SettlementAttemptRecord[]> {
    return [...this.settlementAttempts.values()]
      .filter((attempt) => sessionId === undefined || attempt.sessionId === sessionId)
      .map((attempt) => structuredClone(attempt));
  }
  async getInventory(productId: string): Promise<InventoryRecord | undefined> {
    const inventory = this.inventory.get(productId);
    return inventory ? structuredClone(inventory) : undefined;
  }
  async putInventoryIfAbsent(inventory: InventoryRecord): Promise<InventoryRecord> {
    const existing = this.inventory.get(inventory.productId);
    if (existing) return structuredClone(existing);
    this.inventory.set(inventory.productId, structuredClone(inventory));
    return structuredClone(inventory);
  }
  async createReservationWithInventory(reservation: ReservationRecord): Promise<void> {
    const active = [...this.reservations.values()].some((entry) => entry.sessionId === reservation.sessionId && entry.state === "ACTIVE");
    if (active) throw new Error("MAX_ACTIVE_RESERVATIONS");
    const inventory = this.inventory.get(reservation.productId);
    if (!inventory || inventory.stock < reservation.quantity) throw new Error("OUT_OF_STOCK");
    inventory.stock -= reservation.quantity;
    inventory.updatedAt = reservation.createdAt;
    this.inventory.set(inventory.productId, inventory);
    this.reservations.set(reservation.reservationId, structuredClone(reservation));
  }
  async finalizeReservationWithInventory(sessionId: string, reservationId: string, state: Exclude<ReservationState, "ACTIVE">, nowMs: number): Promise<{ reservation: ReservationRecord; changed: boolean }> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new Error("RESERVATION_NOT_FOUND");
    if (reservation.sessionId !== sessionId) throw new Error("RESERVATION_SESSION_MISMATCH");
    if (reservation.state !== "ACTIVE") return { reservation: structuredClone(reservation), changed: false };
    if (state === "EXPIRED" && nowMs < new Date(reservation.expiresAt).getTime()) throw new Error("RESERVATION_NOT_EXPIRED");
    reservation.state = state;
    if (state === "RELEASED" || state === "EXPIRED") {
      const inventory = this.inventory.get(reservation.productId);
      if (!inventory) throw new Error("PRODUCT_NOT_FOUND");
      inventory.stock += reservation.quantity;
      inventory.updatedAt = new Date(nowMs).toISOString();
      this.inventory.set(inventory.productId, inventory);
    }
    this.reservations.set(reservationId, structuredClone(reservation));
    return { reservation: structuredClone(reservation), changed: true };
  }
  async getIdempotent(scope: string, key: string): Promise<unknown | undefined> {
    const record = this.idempotency.get(`${scope}:${key}`);
    return record?.status === "COMPLETED" ? structuredClone(record.value) : undefined;
  }
  async putIdempotent(scope: string, key: string, value: unknown): Promise<void> {
    this.idempotency.set(`${scope}:${key}`, { fingerprint: "legacy", status: "COMPLETED", value: structuredClone(value) });
  }
  async claimIdempotent(scope: string, key: string, fingerprint: string): Promise<IdempotencyClaim> {
    const id = `${scope}:${key}`;
    const existing = this.idempotency.get(id);
    if (!existing) {
      this.idempotency.set(id, { fingerprint, status: "IN_PROGRESS" });
      return { status: "CLAIMED" };
    }
    if (existing.fingerprint !== fingerprint) return { status: "CONFLICT" };
    if (existing.status === "IN_PROGRESS") return { status: "IN_PROGRESS" };
    return { status: "COMPLETED", value: structuredClone(existing.value) };
  }
  async completeIdempotent(scope: string, key: string, fingerprint: string, value: unknown): Promise<void> {
    const id = `${scope}:${key}`;
    const existing = this.idempotency.get(id);
    if (!existing || existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_CLAIM_MISSING");
    this.idempotency.set(id, { fingerprint, status: "COMPLETED", value: structuredClone(value) });
  }
  async releaseIdempotent(scope: string, key: string, fingerprint: string): Promise<void> {
    const id = `${scope}:${key}`;
    const existing = this.idempotency.get(id);
    if (existing?.status === "IN_PROGRESS" && existing.fingerprint === fingerprint) this.idempotency.delete(id);
  }
}
