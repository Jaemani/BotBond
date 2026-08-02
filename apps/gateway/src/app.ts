import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import swagger from "@fastify/swagger";
import {
  policyHash,
  sha256Hash,
  validateAccessPolicy,
  validateCatalog,
  type AccessPolicy,
  type BondAdapter,
  type BondSettlementResult,
  type BotBondEvent,
  type BotBondEventType,
  type MerchantCapabilityCatalog,
  type PaymentAdapter,
  type UsageSettlementResult,
  type SettlementReceipt,
} from "@botbond/contracts";
import { createLogger, redact, type StructuredLogger } from "@botbond/observability";
import { adaptersFromEnvironment } from "./adapters.js";
import { validateExpiredReservationSettlement, validateUsageSettlement, validateValidCloseSettlement } from "./adapter-validation.js";
import type { Clock } from "./clock.js";
import { SystemClock } from "./clock.js";
import { DemoCommerceApi, CommerceError } from "./commerce.js";
import { FakeIntentCompiler, HttpIntentCompiler, type IntentCompiler } from "./compiler.js";
import { InMemoryRepository, type Repository, type ReservationRecord, type SessionRecord } from "./repository.js";
import { eventsAfterLastId, SessionEventHub, serializeSse } from "./event-stream.js";
import { createSettlementEvidence } from "./settlement-evidence.js";

interface BuildOptions {
  repository?: Repository;
  clock?: Clock;
  paymentAdapter?: PaymentAdapter;
  bondAdapter?: BondAdapter;
  intentCompiler?: IntentCompiler;
  catalog?: MerchantCapabilityCatalog;
  logger?: StructuredLogger;
  eventHub?: SessionEventHub;
  settlementSigningSecret?: string;
  settlementAuthority?: string;
  tokenTtlMs?: number;
}
interface IntentBody {
  task: string;
  agentWallet: string;
  budget: { usageCapAtomic: string; bondCapAtomic: string };
}
interface SessionBody {
  intentId: string;
  policyHash: string;
  paymentCredential: string;
  bondAccount?: string;
}
interface AccessAuthorization {
  session: SessionRecord;
  policy: AccessPolicy;
  operation: AccessPolicy["allowedOperations"][number];
  path: string;
}

const require = createRequire(import.meta.url);
const loadCatalog = (): MerchantCapabilityCatalog =>
  JSON.parse(readFileSync(require.resolve("@botbond/contracts/fixtures/merchant-catalog.json"), "utf8")) as MerchantCapabilityCatalog;
const tokenDigest = (token: string): string => createHash("sha256").update(token).digest("hex");
const parseBearer = (request: FastifyRequest): string | undefined => {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
};
const safeTokenMatch = (token: string, expected: string): boolean => {
  const actual = Buffer.from(tokenDigest(token));
  const stored = Buffer.from(expected);
  return actual.length === stored.length && timingSafeEqual(actual, stored);
};
const pathMatches = (template: string, actual: string): boolean => {
  const escaped = template.split("/").map((segment) => segment.startsWith("{") && segment.endsWith("}") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/");
  return new RegExp(`^${escaped}$`).test(actual);
};
const filterFields = (value: unknown, allowed: string[]): unknown => {
  if (Array.isArray(value)) return value.map((entry) => filterFields(entry, allowed));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => allowed.includes(key)));
};

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  const clock = options.clock ?? new SystemClock();
  const repository = options.repository ?? new InMemoryRepository();
  const adapters = options.paymentAdapter && options.bondAdapter ? undefined : adaptersFromEnvironment();
  const payment = options.paymentAdapter ?? adapters!.payment;
  const bond = options.bondAdapter ?? adapters!.bond;
  const catalog = options.catalog ?? loadCatalog();
  const catalogValidation = validateCatalog(catalog);
  if (!catalogValidation.valid) throw new Error(`INVALID_MERCHANT_CATALOG:${catalogValidation.errors.join(";")}`);
  const compiler = options.intentCompiler ?? (process.env.INTENT_COMPILER_URL ? new HttpIntentCompiler(process.env.INTENT_COMPILER_URL) : new FakeIntentCompiler(clock));
  const logger = options.logger ?? createLogger();
  const eventHub = options.eventHub ?? new SessionEventHub();
  const commerce = new DemoCommerceApi(repository, clock);
  await commerce.initialize();
  const tokenTtlMs = options.tokenTtlMs ?? 5 * 60_000;
  const settlementSigningSecret = options.settlementSigningSecret ?? process.env.SETTLEMENT_SIGNING_SECRET ?? "fake-local-settlement-secret";
  const settlementAuthority = options.settlementAuthority ?? process.env.SETTLEMENT_AUTHORITY ?? "botbond-gateway-local";
  const app = Fastify({ logger: false });
  await app.register(swagger, {
    openapi: {
      info: { title: "BotBond Agent Access Gateway", version: "0.1.0" },
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    },
  });

  const emit = async (sessionId: string, type: BotBondEventType, traceId: string, data: Record<string, unknown> = {}): Promise<void> => {
    const event: BotBondEvent = { eventId: `evt_${randomUUID()}`, sessionId, occurredAt: clock.now().toISOString(), type, data: redact(data) as Record<string, unknown>, traceId };
    await repository.appendEvent(event);
    eventHub.publish(event);
  };
  const error = (reply: FastifyReply, statusCode: number, code: string, retryable = false): FastifyReply =>
    reply.code(statusCode).send({ error: { code, retryable } });

  app.addHook("onRequest", async (request) => {
    request.headers["x-trace-id"] ??= `tr_${randomUUID()}`;
  });
  app.addHook("onResponse", async (request, reply) => {
    logger.info("request_completed", { traceId: request.headers["x-trace-id"], method: request.method, url: request.url, statusCode: reply.statusCode, authorization: request.headers.authorization });
  });

  app.get("/openapi.json", async () => app.swagger());
  const fakeMode = (process.env.ADAPTER_MODE ?? "fake") === "fake";
  app.get("/.well-known/agent-access", async () => ({
    protocol: "botbond/v1",
    intentEndpoint: "/v1/intents",
    sessionEndpoint: "/v1/sessions",
    catalogUrl: "/v1/catalog",
    payment: { provider: "pay.sh", mode: "SPIKE_DEPENDENT", ...(fakeMode ? { integration: "FAKE_ADAPTER_FIXTURE" } : {}) },
    bond: { network: "solana-devnet", programId: "TBD", ...(fakeMode ? { integration: "FAKE_ADAPTER_FIXTURE" } : {}) },
  }));
  app.get("/v1/catalog", async () => catalog);

  app.post<{ Body: IntentBody }>("/v1/intents", async (request, reply) => {
    const traceId = String(request.headers["x-trace-id"]);
    if (!request.body || typeof request.body.task !== "string" || typeof request.body.agentWallet !== "string" || !request.body.budget) {
      return error(reply, 400, "INVALID_INTENT_REQUEST");
    }
    const intentId = `int_${randomUUID()}`;
    await emit(intentId, "INTENT_RECEIVED", traceId, { task: request.body.task });
    let compiled;
    try {
      compiled = await compiler.compile({ task: request.body.task, agentWallet: request.body.agentWallet, budget: request.body.budget, merchantCapabilityCatalog: catalog });
    } catch (cause) {
      logger.error("intent_compile_failed", { traceId, cause: String(cause) });
      return error(reply, 422, "INTENT_COMPILATION_FAILED", false);
    }
    const validation = validateAccessPolicy(compiled.policy, catalog);
    if (!validation.valid) return reply.code(422).send({ error: { code: "INVALID_COMPILED_POLICY", retryable: false, details: validation.errors } });
    const hash = policyHash(compiled.policy);
    const record = {
      intentId,
      policy: compiled.policy,
      policyHash: hash,
      explanation: compiled.explanation,
      excludedPermissions: compiled.excludedPermissions,
      ...(compiled.validationMetadata.fixtureMarker ? { fixtureMarker: compiled.validationMetadata.fixtureMarker } : {}),
    };
    await repository.saveIntent(record);
    await emit(intentId, "POLICY_COMPILED", traceId, { policyHash: hash, validationMetadata: compiled.validationMetadata });
    return { ...record, validationMetadata: compiled.validationMetadata, paymentTerms: { usageCapAtomic: compiled.policy.constraints.usageCapAtomic }, bondTerms: { amountAtomic: compiled.policy.constraints.bondAmountAtomic, required: compiled.policy.bondedActions.length > 0 } };
  });

  app.post<{ Body: SessionBody }>("/v1/sessions", async (request, reply) => {
    const traceId = String(request.headers["x-trace-id"]);
    const idempotencyKey = String(request.headers["idempotency-key"] ?? "");
    if (!idempotencyKey) return error(reply, 400, "IDEMPOTENCY_KEY_REQUIRED");
    const fingerprint = sha256Hash({ intentId: request.body?.intentId, policyHash: request.body?.policyHash, paymentCredential: request.body?.paymentCredential, bondAccount: request.body?.bondAccount ?? null });
    const claim = await repository.claimIdempotent("create-session", idempotencyKey, fingerprint);
    if (claim.status === "CONFLICT") return error(reply, 409, "IDEMPOTENCY_KEY_CONFLICT");
    if (claim.status === "IN_PROGRESS") return error(reply, 409, "IDEMPOTENCY_IN_PROGRESS", true);
    if (claim.status === "COMPLETED") return claim.value;
    const abortSessionCreation = async (statusCode: number, code: string, retryable = false): Promise<FastifyReply> => {
      await repository.releaseIdempotent("create-session", idempotencyKey, fingerprint);
      return error(reply, statusCode, code, retryable);
    };
    try {
      const intent = await repository.getIntent(request.body?.intentId);
      if (!intent) return await abortSessionCreation(404, "INTENT_NOT_FOUND");
      if (intent.policyHash !== request.body.policyHash) return await abortSessionCreation(409, "POLICY_HASH_MISMATCH");
    const sessionId = `ses_${randomUUID()}`;
    let session: SessionRecord = {
      sessionId,
      intentId: intent.intentId,
      policy: intent.policy,
      policyHash: intent.policyHash,
      state: "CREATED",
      expiresAt: new Date(Math.min(new Date(intent.policy.constraints.expiresAt).getTime(), clock.now().getTime() + tokenTtlMs)).toISOString(),
      calls: 0,
      operationCalls: {},
      requestTimestamps: [],
      traceId,
    };
    await repository.saveSession(session);
    await emit(sessionId, "INTENT_RECEIVED", traceId, { intentId: intent.intentId, purpose: intent.policy.purpose });
    await emit(sessionId, "POLICY_COMPILED", traceId, {
      intentId: intent.intentId,
      policy: intent.policy,
      policyHash: intent.policyHash,
      excludedPermissions: intent.excludedPermissions,
      explanation: intent.explanation,
      ...(intent.fixtureMarker ? { fixtureMarker: intent.fixtureMarker } : {}),
    });
    session = await repository.transitionSession(sessionId, "CREATED", "POLICY_READY");
    const verification = await payment.verifyCredential({ sessionId, credential: request.body.paymentCredential });
    if (verification.status !== "CONFIRMED") return await abortSessionCreation(verification.retryable ? 503 : 402, verification.failureCode ?? "PAYMENT_NOT_CONFIRMED", verification.retryable);
    if (verification.usageLimitAtomic === undefined || BigInt(verification.usageLimitAtomic) < BigInt(intent.policy.constraints.usageCapAtomic)) {
      return await abortSessionCreation(402, "PAYMENT_CAP_INSUFFICIENT");
    }
    session = await repository.transitionSession(sessionId, "POLICY_READY", "PAYMENT_READY");
    if (verification.providerReference) session.paymentReference = verification.providerReference;
    await repository.saveSession(session);
    await emit(sessionId, "PAYMENT_VERIFIED", traceId, { status: verification.status, fixtureMarker: verification.fixtureMarker });
    if (intent.policy.bondedActions.length > 0) {
      if (!request.body.bondAccount) return await abortSessionCreation(402, "BOND_REQUIRED");
      const result = await bond.verifyOpenBond({ sessionId, bondAccount: request.body.bondAccount, policyHash: intent.policyHash, amountAtomic: intent.policy.constraints.bondAmountAtomic, maxPenaltyAtomic: intent.policy.constraints.maxPenaltyAtomic });
      if (result.status !== "CONFIRMED") return await abortSessionCreation(result.retryable ? 503 : 402, result.failureCode ?? "BOND_NOT_CONFIRMED", result.retryable);
      session = await repository.transitionSession(sessionId, "PAYMENT_READY", "BONDED");
      if (result.providerReference) session.bondReference = result.providerReference;
      await repository.saveSession(session);
      await emit(sessionId, "BOND_OPENED", traceId, { status: result.status, fixtureMarker: result.fixtureMarker });
      session = await repository.transitionSession(sessionId, "BONDED", "ACTIVE");
    } else {
      session = await repository.transitionSession(sessionId, "PAYMENT_READY", "ACTIVE");
    }
    const token = randomBytes(32).toString("base64url");
    session.tokenHash = tokenDigest(token);
    await repository.saveSession(session);
    await emit(sessionId, "SESSION_ACTIVATED", traceId, { expiresAt: session.expiresAt });
    const response = { sessionId, token, expiresAt: session.expiresAt, eventStream: `/v1/sessions/${sessionId}/events` };
    await repository.completeIdempotent("create-session", idempotencyKey, fingerprint, response);
    return response;
    } catch (cause) {
      await repository.releaseIdempotent("create-session", idempotencyKey, fingerprint);
      throw cause;
    }
  });

  const requireActiveToken = async (request: FastifyRequest, reply: FastifyReply, sessionId: string): Promise<SessionRecord | undefined> => {
    const session = await repository.getSession(sessionId);
    if (!session) {
      error(reply, 404, "SESSION_NOT_FOUND");
      return undefined;
    }
    const token = parseBearer(request);
    if (!token || !session.tokenHash || !safeTokenMatch(token, session.tokenHash)) {
      error(reply, 401, "INVALID_TOKEN");
      return undefined;
    }
    if (clock.now().getTime() >= new Date(session.expiresAt).getTime()) {
      error(reply, 401, "TOKEN_EXPIRED");
      return undefined;
    }
    return session;
  };

  const authorize = async (request: FastifyRequest, reply: FastifyReply): Promise<AccessAuthorization | undefined> => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const path = `/${(request.params as { "*": string })["*"]}`;
    const traceId = String(request.headers["x-trace-id"]);
    const session = await repository.getSession(sessionId);
    const deny = async (status: number, code: string): Promise<undefined> => {
      if (session && code !== "INVALID_TOKEN" && code !== "TOKEN_EXPIRED") {
        await emit(sessionId, "REQUEST_DENIED", traceId, { path, method: request.method, reason: code, penaltyAtomic: "0" });
      }
      error(reply, status, code);
      return undefined;
    };
    if (!session) return deny(404, "SESSION_NOT_FOUND");
    const idempotentExpire = session.state === "EXPIRED" && request.method === "POST" && /^\/reservations\/[^/]+\/expire$/.test(path);
    if (session.state !== "ACTIVE" && !idempotentExpire) return deny(403, "SESSION_NOT_ACTIVE");
    const token = parseBearer(request);
    if (!token || !session.tokenHash || !safeTokenMatch(token, session.tokenHash)) return deny(401, "INVALID_TOKEN");
    if (clock.now().getTime() >= new Date(session.expiresAt).getTime()) return deny(401, "TOKEN_EXPIRED");
    const operation = session.policy.allowedOperations.find((entry) => entry.method === request.method && pathMatches(entry.pathTemplate, path));
    if (!operation) return deny(403, "OPERATION_NOT_ALLOWED");
    const operationKey = `${operation.method} ${operation.pathTemplate}`;
    if ((session.operationCalls[operationKey] ?? 0) >= operation.maxCalls) return deny(429, "OPERATION_CALL_LIMIT");
    if (session.calls >= session.policy.constraints.maxTotalCalls) return deny(429, "TOTAL_CALL_LIMIT");
    const minuteAgo = clock.now().getTime() - 60_000;
    session.requestTimestamps = session.requestTimestamps.filter((timestamp) => timestamp > minuteAgo);
    if (session.requestTimestamps.length >= session.policy.constraints.maxRequestsPerMinute) return deny(429, "RATE_LIMIT");
    return { session, policy: session.policy, operation, path };
  };

  app.all<{ Params: { sessionId: string; "*": string } }>("/v1/access/:sessionId/*", async (request, reply) => {
    const authorization = await authorize(request, reply);
    if (!authorization) return reply;
    const { session, policy, operation, path } = authorization;
    const traceId = String(request.headers["x-trace-id"]);
    const key = `${operation.method} ${operation.pathTemplate}`;
    let payload: unknown;
    let eventType: BotBondEventType = "REQUEST_ALLOWED";
    let countRequest = true;
    if (!/^POST \/reservations\/[^/]+\/expire$/.test(`${request.method} ${path}`)) {
      try {
        const reserved = await repository.reserveRequest(session.sessionId, { operationKey: key, operationMaxCalls: operation.maxCalls, maxTotalCalls: policy.constraints.maxTotalCalls, maxRequestsPerMinute: policy.constraints.maxRequestsPerMinute, nowMs: clock.now().getTime() });
        session.calls = reserved.calls;
        session.operationCalls = reserved.operationCalls;
        session.requestTimestamps = reserved.requestTimestamps;
      } catch (cause) {
        const code = cause instanceof Error ? cause.message : "REQUEST_RESERVATION_FAILED";
        if (["OPERATION_CALL_LIMIT", "TOTAL_CALL_LIMIT", "RATE_LIMIT"].includes(code)) return error(reply, 429, code);
        throw cause;
      }
    }
    let expirySettlement: BondSettlementResult | undefined;
    let expiryUsage: UsageSettlementResult | undefined;
    let expiryUsageChargedAtomic: string | undefined;
    let expirySettledAmounts: { bondRefundedAtomic: string; penaltyAtomic: string } | undefined;
    try {
      if (request.method === "GET" && path === "/products") payload = await commerce.searchProducts();
      else {
        const inventoryMatch = path.match(/^\/products\/([^/]+)\/inventory$/);
        const productMatch = path.match(/^\/products\/([^/]+)$/);
        const releaseMatch = path.match(/^\/reservations\/([^/]+)\/release$/);
        const consumeMatch = path.match(/^\/reservations\/([^/]+)\/consume$/);
        const expireMatch = path.match(/^\/reservations\/([^/]+)\/expire$/);
        if (request.method === "GET" && inventoryMatch?.[1]) payload = await commerce.getInventory(inventoryMatch[1]);
        else if (request.method === "GET" && productMatch?.[1]) payload = await commerce.getProduct(productMatch[1]);
        else if (request.method === "GET" && path === "/seller-contacts") payload = commerce.getSellerContacts();
        else if (request.method === "POST" && path === "/reservations") {
          if (session.state !== "ACTIVE" || policy.bondedActions.length === 0 || !session.bondReference) return error(reply, 403, "CONFIRMED_BOND_REQUIRED");
          const body = request.body as { productId?: string; quantity?: number };
          const action = policy.bondedActions.find((entry) => entry.operationId === "reserve-inventory");
          if (!action || !body?.productId) return error(reply, 400, "INVALID_RESERVATION_REQUEST");
          payload = await commerce.createReservation(session.sessionId, body.productId, body.quantity ?? 1, action.ttlSeconds);
          eventType = "RESERVATION_CREATED";
        } else if (request.method === "POST" && releaseMatch?.[1]) {
          const result = await commerce.finalizeReservation(session.sessionId, releaseMatch[1], "RELEASED");
          payload = result.reservation;
          if (result.changed) eventType = "RESERVATION_RELEASED";
        } else if (request.method === "POST" && consumeMatch?.[1]) {
          const result = await commerce.finalizeReservation(session.sessionId, consumeMatch[1], "CONSUMED");
          payload = result.reservation;
          if (result.changed) eventType = "RESERVATION_CONSUMED";
        } else if (request.method === "POST" && expireMatch?.[1]) {
          const prepared = await commerce.prepareExpiration(session.sessionId, expireMatch[1]);
          if (prepared.state !== "ACTIVE") {
            payload = prepared;
            countRequest = false;
          } else {
            try {
              const reserved = await repository.reserveRequest(session.sessionId, { operationKey: key, operationMaxCalls: operation.maxCalls, maxTotalCalls: policy.constraints.maxTotalCalls, maxRequestsPerMinute: policy.constraints.maxRequestsPerMinute, nowMs: clock.now().getTime() });
              session.calls = reserved.calls;
              session.operationCalls = reserved.operationCalls;
              session.requestTimestamps = reserved.requestTimestamps;
            } catch (cause) {
              const code = cause instanceof Error ? cause.message : "REQUEST_RESERVATION_FAILED";
              if (["OPERATION_CALL_LIMIT", "TOTAL_CALL_LIMIT", "RATE_LIMIT"].includes(code)) return error(reply, 429, code);
              throw cause;
            }
            const action = policy.bondedActions[0];
            if (!action) return error(reply, 409, "BONDED_ACTION_MISSING");
            expiryUsage = await payment.getUsageSettlement({ sessionId: session.sessionId, calls: session.calls, usageCapAtomic: policy.constraints.usageCapAtomic });
            if (expiryUsage.status !== "CONFIRMED") return error(reply, 503, expiryUsage.failureCode ?? "USAGE_SETTLEMENT_PENDING", true);
            const usageChargedAtomic = validateUsageSettlement(expiryUsage, policy.constraints.usageCapAtomic);
            expiryUsageChargedAtomic = usageChargedAtomic;
            const penaltyAtomic = action.expiryPenaltyAtomic;
            const bondRefundedAtomic = (BigInt(policy.constraints.bondAmountAtomic) - BigInt(penaltyAtomic)).toString();
            const evidence = createSettlementEvidence({ sessionId: session.sessionId, policyHash: session.policyHash, reservationId: prepared.reservationId, outcome: "EXPIRED_RESERVATION", usageChargedAtomic, penaltyAtomic, bondRefundedAtomic, nonce: `expiry:${prepared.reservationId}`, issuedAt: clock.now().toISOString(), authority: settlementAuthority }, settlementSigningSecret);
            expirySettlement = await bond.requestExpiredReservationSettlement({ sessionId: session.sessionId, policyHash: session.policyHash, penaltyAtomic, maxPenaltyAtomic: policy.constraints.maxPenaltyAtomic, bondAmountAtomic: policy.constraints.bondAmountAtomic, reservationId: prepared.reservationId, evidence });
            if (expirySettlement.status !== "CONFIRMED") return error(reply, expirySettlement.retryable ? 503 : 409, expirySettlement.failureCode ?? "EXPIRY_SETTLEMENT_NOT_CONFIRMED", expirySettlement.retryable);
            const settledAmounts = validateExpiredReservationSettlement(expirySettlement, {
              penaltyAtomic,
              maxPenaltyAtomic: policy.constraints.maxPenaltyAtomic,
              bondAmountAtomic: policy.constraints.bondAmountAtomic,
            });
            expirySettledAmounts = settledAmounts;
            const result = await commerce.finalizeReservation(session.sessionId, expireMatch[1], "EXPIRED");
            payload = result.reservation;
            result.reservation.settlementRequested = true;
            await repository.saveReservation(result.reservation);
            eventType = "RESERVATION_EXPIRED";
            await emit(session.sessionId, "PENALTY_SETTLED", traceId, { penaltyAtomic: settledAmounts.penaltyAtomic, bondRefundedAtomic: settledAmounts.bondRefundedAtomic, fixtureMarker: expirySettlement.fixtureMarker });
          }
        } else return error(reply, 404, "UPSTREAM_OPERATION_NOT_IMPLEMENTED");
      }
    } catch (cause) {
      if (cause instanceof CommerceError) return error(reply, 409, cause.code);
      throw cause;
    }
    if (countRequest) {
      const eventData: Record<string, unknown> = { method: request.method, path, callIndex: session.calls };
      if (payload && typeof payload === "object") {
        const reservation = payload as Partial<ReservationRecord>;
        if (reservation.reservationId) eventData.reservationId = reservation.reservationId;
        if (reservation.productId) eventData.productId = reservation.productId;
        if (reservation.expiresAt) eventData.expiresAt = reservation.expiresAt;
      }
      await emit(session.sessionId, eventType, traceId, eventData);
    }
    if (eventType === "RESERVATION_EXPIRED" && expirySettlement && expiryUsage && expiryUsageChargedAtomic && expirySettledAmounts) {
      await emit(session.sessionId, "USAGE_SETTLED", traceId, { calls: session.calls, usageChargedAtomic: expiryUsageChargedAtomic, fixtureMarker: expiryUsage.fixtureMarker });
      const receiptBody = {
        sessionId: session.sessionId,
        outcome: "EXPIRED" as const,
        policyHash: session.policyHash,
        calls: session.calls,
        usageChargedAtomic: expiryUsageChargedAtomic,
        bondRefundedAtomic: expirySettledAmounts.bondRefundedAtomic,
        penaltyAtomic: expirySettledAmounts.penaltyAtomic,
        transactions: [
          { kind: "PAYMENT" as const, status: expiryUsage.status, ...(expiryUsage.providerReference ? { providerReference: expiryUsage.providerReference } : {}), ...(expiryUsage.fixtureMarker ? { fixtureMarker: expiryUsage.fixtureMarker } : {}) },
          { kind: "BOND" as const, status: expirySettlement.status, ...(expirySettlement.providerReference ? { providerReference: expirySettlement.providerReference } : {}), ...(expirySettlement.fixtureMarker ? { fixtureMarker: expirySettlement.fixtureMarker } : {}) },
        ],
      };
      const expiredSession = await repository.transitionSession(session.sessionId, "ACTIVE", "EXPIRED");
      expiredSession.receipt = { ...receiptBody, receiptHash: sha256Hash(receiptBody) };
      await repository.saveSession(expiredSession);
      payload = { ...(payload as object), receipt: expiredSession.receipt };
    }
    return filterFields(payload, operation.allowedResponseFields);
  });

  app.post<{ Params: { sessionId: string } }>("/v1/sessions/:sessionId/close", async (request, reply) => {
    const sessionId = request.params.sessionId;
    let session = await requireActiveToken(request, reply, sessionId);
    if (!session) return reply;
    const traceId = String(request.headers["x-trace-id"]);
    const key = String(request.headers["idempotency-key"] ?? "");
    if (!key) return error(reply, 400, "IDEMPOTENCY_KEY_REQUIRED");
    const closeFingerprint = sha256Hash({ sessionId, policyHash: session.policyHash, action: "close" });
    const closeClaim = await repository.claimIdempotent(`close:${sessionId}`, key, closeFingerprint);
    if (closeClaim.status === "CONFLICT") return error(reply, 409, "IDEMPOTENCY_KEY_CONFLICT");
    if (closeClaim.status === "IN_PROGRESS") return error(reply, 409, "IDEMPOTENCY_IN_PROGRESS", true);
    if (closeClaim.status === "COMPLETED") return closeClaim.value;
    const abortClose = async (statusCode: number, code: string, retryable = false): Promise<FastifyReply> => {
      await repository.releaseIdempotent(`close:${sessionId}`, key, closeFingerprint);
      return error(reply, statusCode, code, retryable);
    };
    try {
    if (session.receipt) return await abortClose(409, "IDEMPOTENCY_KEY_CONFLICT");
    if (session.state !== "ACTIVE") return await abortClose(409, "INVALID_STATE_TRANSITION");
    const activeReservations = (await repository.listReservations(sessionId)).filter((record) => record.state === "ACTIVE");
    if (activeReservations.length > 0) return await abortClose(409, "ACTIVE_RESERVATION_EXISTS");
    const usage = await payment.getUsageSettlement({ sessionId, calls: session.calls, usageCapAtomic: session.policy.constraints.usageCapAtomic });
    if (usage.status !== "CONFIRMED") return await abortClose(503, usage.failureCode ?? "USAGE_SETTLEMENT_PENDING", true);
    let usageChargedAtomic: string;
    try {
      usageChargedAtomic = validateUsageSettlement(usage, session.policy.constraints.usageCapAtomic);
    } catch {
      return await abortClose(502, "INVALID_USAGE_SETTLEMENT");
    }
    await emit(sessionId, "USAGE_SETTLED", traceId, { calls: session.calls, usageChargedAtomic, fixtureMarker: usage.fixtureMarker });
    let bondRefundedAtomic = "0";
    let bondReference: string | undefined;
    let bondResultMarker: "FAKE_ADAPTER_FIXTURE" | undefined;
    if (session.policy.bondedActions.length > 0) {
      const evidence = createSettlementEvidence({ sessionId, policyHash: session.policyHash, outcome: "VALID_CLOSE", usageChargedAtomic, penaltyAtomic: "0", bondRefundedAtomic: session.policy.constraints.bondAmountAtomic, nonce: `close:${sessionId}`, issuedAt: clock.now().toISOString(), authority: settlementAuthority }, settlementSigningSecret);
      const result = await bond.requestValidClose({ sessionId, policyHash: session.policyHash, amountAtomic: session.policy.constraints.bondAmountAtomic, evidence });
      if (result.status !== "CONFIRMED") return await abortClose(503, result.failureCode ?? "BOND_CLOSE_PENDING", true);
      let settledAmounts: { bondRefundedAtomic: string; penaltyAtomic: string };
      try {
        settledAmounts = validateValidCloseSettlement(result, session.policy.constraints.bondAmountAtomic);
      } catch {
        return await abortClose(502, "INVALID_BOND_SETTLEMENT");
      }
      bondRefundedAtomic = settledAmounts.bondRefundedAtomic;
      bondReference = result.providerReference;
      if (result.fixtureMarker) bondResultMarker = result.fixtureMarker;
      await emit(sessionId, "BOND_REFUNDED", traceId, { bondRefundedAtomic, fixtureMarker: result.fixtureMarker });
    }
    session = await repository.transitionSession(sessionId, "ACTIVE", "CLOSED");
    const receiptBody = {
      sessionId,
      outcome: "CLOSED" as const,
      policyHash: session.policyHash,
      calls: session.calls,
      usageChargedAtomic,
      bondRefundedAtomic,
      penaltyAtomic: "0",
      transactions: [
        { kind: "PAYMENT" as const, status: usage.status, ...(usage.providerReference ? { providerReference: usage.providerReference } : {}), ...(usage.fixtureMarker ? { fixtureMarker: usage.fixtureMarker } : {}) },
        ...(bondReference ? [{ kind: "BOND" as const, status: "CONFIRMED" as const, providerReference: bondReference, ...(bondResultMarker ? { fixtureMarker: bondResultMarker } : {}) }] : []),
      ],
    };
    const receipt: SettlementReceipt = { ...receiptBody, receiptHash: sha256Hash(receiptBody) };
    session.receipt = receipt;
    await repository.saveSession(session);
    await emit(sessionId, "SESSION_CLOSED", traceId, { receiptHash: receipt.receiptHash });
    await repository.completeIdempotent(`close:${sessionId}`, key, closeFingerprint, receipt);
    return receipt;
    } catch (cause) {
      await repository.releaseIdempotent(`close:${sessionId}`, key, closeFingerprint);
      throw cause;
    }
  });

  app.get<{ Params: { sessionId: string } }>("/v1/sessions/:sessionId/receipt", async (request, reply) => {
    const session = await requireActiveToken(request, reply, request.params.sessionId);
    if (!session) return reply;
    if (!session.receipt) return error(reply, 404, "RECEIPT_NOT_READY", true);
    return session.receipt;
  });

  app.get<{ Params: { sessionId: string }; Querystring: { replayOnly?: string } }>("/v1/sessions/:sessionId/events", async (request, reply) => {
    const session = await requireActiveToken(request, reply, request.params.sessionId);
    if (!session) return reply;
    const events = eventsAfterLastId(await repository.listEvents(request.params.sessionId), String(request.headers["last-event-id"] ?? "") || undefined);
    if (String(request.headers.accept).includes("text/event-stream") && request.query.replayOnly !== "true") {
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      const sent = new Set(events.map((event) => event.eventId));
      const buffered: BotBondEvent[] = [];
      let replaying = true;
      const write = (event: BotBondEvent): void => {
        if (sent.has(event.eventId)) return;
        sent.add(event.eventId);
        reply.raw.write(serializeSse(event));
      };
      const unsubscribe = eventHub.subscribe(request.params.sessionId, (event) => {
        if (replaying) buffered.push(event);
        else write(event);
      });
      for (const event of events) {
        sent.delete(event.eventId);
        write(event);
      }
      const catchUp = eventsAfterLastId(await repository.listEvents(request.params.sessionId), String(request.headers["last-event-id"] ?? "") || undefined);
      for (const event of catchUp) write(event);
      buffered.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId));
      for (const event of buffered) write(event);
      replaying = false;
      const heartbeat = setInterval(() => reply.raw.write(": keep-alive\n\n"), 15_000);
      const cleanup = (): void => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      request.raw.once("close", cleanup);
      reply.raw.once("error", cleanup);
      return reply;
    }
    return { events };
  });

  app.decorate("botbond", { repository, commerce, clock, payment, bond, eventHub });
  return app;
}
