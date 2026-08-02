import type { Firestore } from "@google-cloud/firestore";
import type { BotBondEvent, SessionState } from "@botbond/contracts";
import type { IdempotencyClaim, IntentRecord, InventoryRecord, Repository, ReservationRecord, SessionRecord } from "./repository.js";

const allowedTransitions: Record<SessionState, SessionState[]> = {
  CREATED: ["POLICY_READY"],
  POLICY_READY: ["PAYMENT_READY"],
  PAYMENT_READY: ["ACTIVE", "BONDED"],
  BONDED: ["ACTIVE"],
  ACTIVE: ["CLOSED", "VIOLATED", "EXPIRED"],
  CLOSED: [],
  VIOLATED: [],
  EXPIRED: [],
};

function requireData<T>(value: FirebaseFirestore.DocumentData | undefined): T | undefined {
  return value === undefined ? undefined : value as T;
}

export class FirestoreRepository implements Repository {
  constructor(private readonly firestore: Firestore, private readonly namespace = "botbond") {}

  private collection(name: string): FirebaseFirestore.CollectionReference {
    return this.firestore.collection(`${this.namespace}_${name}`);
  }

  async saveIntent(intent: IntentRecord): Promise<void> {
    await this.collection("intents").doc(intent.intentId).set(intent);
  }
  async getIntent(intentId: string): Promise<IntentRecord | undefined> {
    return requireData<IntentRecord>((await this.collection("intents").doc(intentId).get()).data());
  }
  async saveSession(session: SessionRecord): Promise<void> {
    await this.collection("sessions").doc(session.sessionId).set(session);
  }
  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    return requireData<SessionRecord>((await this.collection("sessions").doc(sessionId).get()).data());
  }
  async listSessions(): Promise<SessionRecord[]> {
    return (await this.collection("sessions").get()).docs.map((document) => document.data() as SessionRecord);
  }
  async transitionSession(sessionId: string, expected: SessionState, next: SessionState): Promise<SessionRecord> {
    if (!allowedTransitions[expected].includes(next)) throw new Error(`INVALID_STATE_TRANSITION:${expected}->${next}`);
    const reference = this.collection("sessions").doc(sessionId);
    return await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new Error("SESSION_NOT_FOUND");
      const session = snapshot.data() as SessionRecord;
      if (session.state !== expected) throw new Error(`INVALID_STATE_TRANSITION:${session.state}->${next}`);
      const updated = { ...session, state: next } as SessionRecord;
      transaction.set(reference, updated);
      return updated;
    });
  }
  async reserveRequest(sessionId: string, input: { operationKey: string; operationMaxCalls: number; maxTotalCalls: number; maxRequestsPerMinute: number; nowMs: number }): Promise<SessionRecord> {
    const reference = this.collection("sessions").doc(sessionId);
    return await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new Error("SESSION_NOT_FOUND");
      const session = snapshot.data() as SessionRecord;
      const timestamps = session.requestTimestamps.filter((timestamp) => timestamp > input.nowMs - 60_000);
      if ((session.operationCalls[input.operationKey] ?? 0) >= input.operationMaxCalls) throw new Error("OPERATION_CALL_LIMIT");
      if (session.calls >= input.maxTotalCalls) throw new Error("TOTAL_CALL_LIMIT");
      if (timestamps.length >= input.maxRequestsPerMinute) throw new Error("RATE_LIMIT");
      const updated: SessionRecord = { ...session, calls: session.calls + 1, operationCalls: { ...session.operationCalls, [input.operationKey]: (session.operationCalls[input.operationKey] ?? 0) + 1 }, requestTimestamps: [...timestamps, input.nowMs] };
      transaction.set(reference, updated);
      return updated;
    });
  }
  async appendEvent(event: BotBondEvent): Promise<void> {
    await this.collection("events").doc(event.eventId).create(event);
  }
  async listEvents(sessionId: string): Promise<BotBondEvent[]> {
    const snapshot = await this.collection("events").where("sessionId", "==", sessionId).get();
    return snapshot.docs.map((document) => document.data() as BotBondEvent).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId));
  }
  async saveReservation(reservation: ReservationRecord): Promise<void> {
    await this.collection("reservations").doc(reservation.reservationId).set(reservation);
  }
  async getReservation(reservationId: string): Promise<ReservationRecord | undefined> {
    return requireData<ReservationRecord>((await this.collection("reservations").doc(reservationId).get()).data());
  }
  async listReservations(sessionId: string): Promise<ReservationRecord[]> {
    const snapshot = await this.collection("reservations").where("sessionId", "==", sessionId).get();
    return snapshot.docs.map((document) => document.data() as ReservationRecord);
  }
  async getInventory(productId: string): Promise<InventoryRecord | undefined> {
    return requireData<InventoryRecord>((await this.collection("inventory").doc(productId).get()).data());
  }
  async putInventoryIfAbsent(inventory: InventoryRecord): Promise<InventoryRecord> {
    const reference = this.collection("inventory").doc(inventory.productId);
    return await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) return snapshot.data() as InventoryRecord;
      transaction.create(reference, inventory);
      return inventory;
    });
  }
  async createReservationWithInventory(reservation: ReservationRecord): Promise<void> {
    const inventoryReference = this.collection("inventory").doc(reservation.productId);
    const reservationReference = this.collection("reservations").doc(reservation.reservationId);
    const activeReservationReference = this.collection("activeReservations").doc(reservation.sessionId);
    await this.firestore.runTransaction(async (transaction) => {
      const [inventorySnapshot, reservationSnapshot, activeReservationSnapshot] = await Promise.all([
        transaction.get(inventoryReference),
        transaction.get(reservationReference),
        transaction.get(activeReservationReference),
      ]);
      if (reservationSnapshot.exists) return;
      if (activeReservationSnapshot.exists) throw new Error("MAX_ACTIVE_RESERVATIONS");
      if (!inventorySnapshot.exists) throw new Error("PRODUCT_NOT_FOUND");
      const inventory = inventorySnapshot.data() as InventoryRecord;
      if (inventory.stock < reservation.quantity) throw new Error("OUT_OF_STOCK");
      transaction.set(inventoryReference, { ...inventory, stock: inventory.stock - reservation.quantity, updatedAt: reservation.createdAt });
      transaction.create(reservationReference, reservation);
      transaction.create(activeReservationReference, { reservationId: reservation.reservationId, sessionId: reservation.sessionId });
    });
  }
  async finalizeReservationWithInventory(sessionId: string, reservationId: string, state: Exclude<import("@botbond/contracts").ReservationState, "ACTIVE">, nowMs: number): Promise<{ reservation: ReservationRecord; changed: boolean }> {
    const reservationReference = this.collection("reservations").doc(reservationId);
    const activeReservationReference = this.collection("activeReservations").doc(sessionId);
    return await this.firestore.runTransaction(async (transaction) => {
      const [reservationSnapshot, activeReservationSnapshot] = await Promise.all([
        transaction.get(reservationReference),
        transaction.get(activeReservationReference),
      ]);
      if (!reservationSnapshot.exists) throw new Error("RESERVATION_NOT_FOUND");
      const reservation = reservationSnapshot.data() as ReservationRecord;
      if (reservation.sessionId !== sessionId) throw new Error("RESERVATION_SESSION_MISMATCH");
      if (reservation.state !== "ACTIVE") return { reservation, changed: false };
      if (state === "EXPIRED" && nowMs < new Date(reservation.expiresAt).getTime()) throw new Error("RESERVATION_NOT_EXPIRED");
      if (!activeReservationSnapshot.exists || activeReservationSnapshot.data()?.reservationId !== reservationId) throw new Error("ACTIVE_RESERVATION_INCONSISTENT");
      const updated = { ...reservation, state } as ReservationRecord;
      if (state === "RELEASED" || state === "EXPIRED") {
        const inventoryReference = this.collection("inventory").doc(reservation.productId);
        const inventorySnapshot = await transaction.get(inventoryReference);
        if (!inventorySnapshot.exists) throw new Error("PRODUCT_NOT_FOUND");
        const inventory = inventorySnapshot.data() as InventoryRecord;
        transaction.set(inventoryReference, { ...inventory, stock: inventory.stock + reservation.quantity, updatedAt: new Date(nowMs).toISOString() });
      }
      transaction.set(reservationReference, updated);
      transaction.delete(activeReservationReference);
      return { reservation: updated, changed: true };
    });
  }
  async getIdempotent(scope: string, key: string): Promise<unknown | undefined> {
    const data = (await this.collection("idempotency").doc(this.idempotencyId(scope, key)).get()).data();
    return data?.status === "COMPLETED" || data?.status === undefined ? data?.value : undefined;
  }
  async putIdempotent(scope: string, key: string, value: unknown): Promise<void> {
    const reference = this.collection("idempotency").doc(this.idempotencyId(scope, key));
    await this.firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference);
      if (existing.exists) return;
      transaction.create(reference, { scope, key, fingerprint: "legacy", status: "COMPLETED", value });
    });
  }
  async claimIdempotent(scope: string, key: string, fingerprint: string): Promise<IdempotencyClaim> {
    const reference = this.collection("idempotency").doc(this.idempotencyId(scope, key));
    return await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) {
        transaction.create(reference, { scope, key, fingerprint, status: "IN_PROGRESS" });
        return { status: "CLAIMED" };
      }
      const data = snapshot.data()!;
      if (data.fingerprint !== fingerprint) return { status: "CONFLICT" };
      if (data.status === "IN_PROGRESS") return { status: "IN_PROGRESS" };
      return { status: "COMPLETED", value: data.value };
    });
  }
  async completeIdempotent(scope: string, key: string, fingerprint: string, value: unknown): Promise<void> {
    const reference = this.collection("idempotency").doc(this.idempotencyId(scope, key));
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists || snapshot.data()?.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_CLAIM_MISSING");
      transaction.set(reference, { scope, key, fingerprint, status: "COMPLETED", value });
    });
  }
  async releaseIdempotent(scope: string, key: string, fingerprint: string): Promise<void> {
    const reference = this.collection("idempotency").doc(this.idempotencyId(scope, key));
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists && snapshot.data()?.status === "IN_PROGRESS" && snapshot.data()?.fingerprint === fingerprint) transaction.delete(reference);
    });
  }
  private idempotencyId(scope: string, key: string): string {
    return Buffer.from(`${scope}:${key}`).toString("base64url");
  }
}
