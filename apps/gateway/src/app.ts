import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import swagger from "@fastify/swagger";
import {
  policyHash,
  sha256Hash,
  DEFAULT_UNIT_PRICE_ATOMIC,
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
import { claimSettlementEvidenceNonce, closeAttemptId, expiryAttemptId, getOrCreateSettlementAttempt, updateSettlementAttempt } from "./settlement-attempt.js";
import { createSettlementEvidence } from "./settlement-evidence.js";
import { pollSettlement, type SettlementPollingOptions } from "./settlement-polling.js";
import {
  PUBLIC_DEMO_BEHAVIORS,
  publicDemoFingerprint,
  publicDemoRunnerFromEnvironment,
  type PublicDemoRunner,
} from "./public-demo-runner.js";

const DEFAULT_SETTLEMENT_LEASE_MS = 30_000;
const DEFAULT_BOTBOND_PROGRAM_ID = "HoamYxgGuZoQerLGthZK8K4vLKTvEraZ4o7N8fkjk4bc";
const PAYMENT_INSTRUCTION = "pay.sh x402는 per-call 결제 rail이며, 세션 사용 상한은 BotBond Gateway가 결정적으로 집행합니다. Solana bond는 예약 같은 bonded action만 담보합니다.";

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
  settlementPolling?: SettlementPollingOptions;
  publicDemoRunner?: PublicDemoRunner | null;
}
interface IntentBody {
  task: string;
  agentWallet: string;
  budget: { usageCapAtomic: string; bondCapAtomic: string };
}
interface SessionBody {
  intentId: string;
  policyHash: string;
  sessionId?: string;
  paymentCredential?: string;
  paymentChallenge?: string;
  bondAccount?: string;
}
interface AccessAuthorization {
  session: SessionRecord;
  policy: AccessPolicy;
  operation: AccessPolicy["allowedOperations"][number];
  path: string;
}

const atomicAmountSchema = { type: "string", pattern: "^(0|[1-9][0-9]*)$" } as const;
const intentRequestSchema = {
  $id: "IntentRequest",
  type: "object",
  additionalProperties: false,
  required: ["task", "agentWallet", "budget"],
  properties: {
    task: { type: "string", minLength: 1, maxLength: 4096 },
    agentWallet: { type: "string", minLength: 1, maxLength: 256 },
    budget: {
      type: "object",
      additionalProperties: false,
      required: ["usageCapAtomic", "bondCapAtomic"],
      properties: {
        usageCapAtomic: atomicAmountSchema,
        bondCapAtomic: atomicAmountSchema,
      },
    },
  },
} as const;
const paymentChallengeRequestSchema = {
  $id: "PaymentChallengeRequest",
  type: "object",
  additionalProperties: false,
  required: ["intentId", "sessionId"],
  properties: {
    intentId: { type: "string", pattern: "^int_[A-Za-z0-9_-]+$" },
    sessionId: { type: "string", pattern: "^ses_[A-Za-z0-9_-]{4,124}$" },
  },
} as const;
const sessionRequestSchema = {
  $id: "SessionRequest",
  type: "object",
  additionalProperties: false,
  required: ["intentId", "policyHash", "paymentCredential"],
  properties: {
    intentId: { type: "string", pattern: "^int_[A-Za-z0-9_-]+$" },
    policyHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    sessionId: { type: "string", pattern: "^ses_[A-Za-z0-9_-]{4,124}$" },
    paymentCredential: { type: "string", minLength: 1, maxLength: 8192 },
    paymentChallenge: { type: "string", minLength: 1, maxLength: 8192 },
    bondAccount: { type: "string", minLength: 1, maxLength: 256 },
  },
} as const;

const require = createRequire(import.meta.url);
const loadCatalog = (): MerchantCapabilityCatalog =>
  JSON.parse(readFileSync(require.resolve("@botbond/contracts/fixtures/merchant-catalog.json"), "utf8")) as MerchantCapabilityCatalog;
const tokenDigest = (token: string): string => createHash("sha256").update(token).digest("hex");
const parseSessionToken = (request: FastifyRequest): string | undefined => {
  const botbondToken = request.headers["x-botbond-session-token"];
  if (typeof botbondToken === "string" && botbondToken.length > 0) return botbondToken;
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
  const settlementSigningSecret = options.settlementSigningSecret ?? process.env.BOTBOND_EVIDENCE_SECRET ?? "fake-local-settlement-secret";
  const settlementAuthority = options.settlementAuthority ?? process.env.SETTLEMENT_AUTHORITY ?? "botbond-gateway-local";
  const app = Fastify({ logger: false });
  const publicDemoRunner = options.publicDemoRunner === undefined
    ? publicDemoRunnerFromEnvironment()
    : options.publicDemoRunner ?? undefined;
  app.addSchema(intentRequestSchema);
  app.addSchema(paymentChallengeRequestSchema);
  app.addSchema(sessionRequestSchema);
  await app.register(swagger, {
    openapi: {
      info: { title: "BotBond Agent Access Gateway", version: "0.1.0" },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
          botbondSessionToken: { type: "apiKey", in: "header", name: "x-botbond-session-token" },
        },
      },
    },
  });

  const emit = async (sessionId: string, type: BotBondEventType, traceId: string, data: Record<string, unknown> = {}): Promise<void> => {
    const event: BotBondEvent = { eventId: `evt_${randomUUID()}`, sessionId, occurredAt: clock.now().toISOString(), type, data: redact(data) as Record<string, unknown>, traceId };
    await repository.appendEvent(event);
    eventHub.publish(event);
  };
  const error = (reply: FastifyReply, statusCode: number, code: string, retryable = false): FastifyReply =>
    reply.code(statusCode).send({ error: { code, retryable } });

  app.setErrorHandler((cause, request, reply) => {
    const validation = typeof cause === "object" && cause !== null && "validation" in cause
      ? (cause as { validation?: Array<{ instancePath?: string; message?: string }> }).validation
      : undefined;
    if (validation) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          retryable: false,
          details: validation.map((entry) => `${entry.instancePath || "/"} ${entry.message ?? "is invalid"}`),
        },
      });
    }
    logger.error("request_failed", { traceId: request.headers["x-trace-id"], cause: cause instanceof Error ? cause.message : String(cause) });
    return reply.send(cause);
  });

  app.addHook("onRequest", async (request) => {
    request.headers["x-trace-id"] ??= `tr_${randomUUID()}`;
  });
  app.addHook("onResponse", async (request, reply) => {
    logger.info("request_completed", { traceId: request.headers["x-trace-id"], method: request.method, url: request.url, statusCode: reply.statusCode, authorization: request.headers.authorization });
  });

  app.get("/openapi.json", async () => app.swagger());
  const fakeMode = (process.env.ADAPTER_MODE ?? "fake") === "fake";
  app.get("/healthz", async () => ({
    status: "ok",
    repository: process.env.REPOSITORY_MODE ?? "memory",
    compiler: process.env.INTENT_COMPILER_URL ? "http" : "fake",
    adapter: process.env.ADAPTER_MODE ?? "fake",
  }));
  app.get("/.well-known/agent-access", async () => ({
    protocol: "botbond/v1",
    intentEndpoint: "/v1/intents",
    sessionEndpoint: "/v1/sessions",
    catalogUrl: "/v1/catalog",
    authentication: {
      bearer: "Authorization: Bearer <session-token>",
      paymentMiddlewareCompatible: "x-botbond-session-token: <session-token>",
    },
    payment: {
      provider: "pay.sh",
      mode: "LOCAL_HMAC_CREDENTIAL_BRIDGE",
      railEvidence: "SANDBOX_VERIFIED",
      integration: "FAKE_ADAPTER_FIXTURE",
      ...(process.env.PAY_GATE_URL ? { sandboxPayGateUrl: process.env.PAY_GATE_URL } : {}),
      ...(publicDemoRunner ? { devnetCredentialEndpoint: "/v1/devnet/payment-credentials" } : {}),
    },
    bond: {
      network: "solana-devnet",
      programId: process.env.BOTBOND_PROGRAM_ID ?? DEFAULT_BOTBOND_PROGRAM_ID,
      ...(process.env.PUBLIC_DEMO_MERCHANT ? { publicDemoMerchant: process.env.PUBLIC_DEMO_MERCHANT } : {}),
      ...(fakeMode ? { integration: "FAKE_ADAPTER_FIXTURE" } : {}),
    },
    publicDemo: publicDemoRunner ? {
      endpoint: "/v1/public-demo-runs",
      behaviors: PUBLIC_DEMO_BEHAVIORS,
      sponsored: true,
      createsFreshTransactions: true,
    } : { enabled: false },
    onboardingGuide: "https://github.com/Jaemani/BotBond/blob/main/docs/16-bring-your-agent.md",
  }));
  app.get("/products", async (_request, reply) => {
    reply.header("link", '</.well-known/agent-access>; rel="agent-access"');
    return reply.code(403).send({
      error: {
        code: "UNKNOWN_AUTOMATED_CLIENT",
        retryable: false,
        message: "Automated clients require a scoped BotBond session.",
      },
      agentAccess: {
        protocol: "botbond/v1",
        discovery: "/.well-known/agent-access",
      },
    });
  });
  app.get("/v1/catalog", async () => catalog);

  app.post<{ Body: { behavior?: string } }>("/v1/public-demo-runs", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["behavior"],
        properties: { behavior: { type: "string", enum: [...PUBLIC_DEMO_BEHAVIORS] } },
      },
    },
  }, async (request, reply) => {
    if (!publicDemoRunner) return error(reply, 503, "PUBLIC_DEMO_DISABLED", true);
    const behavior = request.body?.behavior;
    if (!PUBLIC_DEMO_BEHAVIORS.includes(behavior as (typeof PUBLIC_DEMO_BEHAVIORS)[number])) {
      return error(reply, 400, "PUBLIC_DEMO_BEHAVIOR_INVALID");
    }
    const forwarded = String(request.headers["x-forwarded-for"] ?? request.ip).split(",")[0]?.trim() || request.ip;
    const salt = process.env.BOTBOND_PUBLIC_DEMO_SALT ?? settlementSigningSecret;
    try {
      const run = await publicDemoRunner.createRun({
        behavior: behavior as (typeof PUBLIC_DEMO_BEHAVIORS)[number],
        clientFingerprint: publicDemoFingerprint(forwarded, salt),
        inject: async (input) => {
          const response = await app.inject({
            method: input.method,
            url: input.url,
            payload: input.payload,
            ...(input.headers ? { headers: input.headers } : {}),
          });
          return { statusCode: response.statusCode, body: response.body };
        },
      });
      await emit(run.sessionId, "BOND_OPENED", String(request.headers["x-trace-id"]), {
        status: run.openTransaction.status,
        bondAccount: run.bondAccount,
        transaction: run.openTransaction,
        source: "PUBLIC_SPONSORED_RUNNER",
      });
      reply.header("cache-control", "no-store");
      return run;
    } catch (cause) {
      const code = cause instanceof Error ? cause.message.split(":")[0] : "PUBLIC_DEMO_FAILED";
      if (code === "PUBLIC_DEMO_COOLDOWN") return error(reply, 429, code, true);
      if (code === "PUBLIC_DEMO_DAILY_LIMIT") return error(reply, 429, code, true);
      if (code === "PUBLIC_DEMO_BUSY") return error(reply, 503, code, true);
      logger.error("public_demo_failed", { cause: String(cause) });
      return error(reply, 503, "PUBLIC_DEMO_FAILED", true);
    }
  });

  app.post<{ Body: { intentId?: string; sessionId?: string } }>("/v1/devnet/payment-credentials", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["intentId", "sessionId"],
        properties: {
          intentId: { type: "string", pattern: "^int_[A-Za-z0-9_-]+$" },
          sessionId: { type: "string", pattern: "^ses_[A-Za-z0-9_-]{4,124}$" },
        },
      },
    },
  }, async (request, reply) => {
    if (!publicDemoRunner) return error(reply, 503, "DEVNET_CREDENTIAL_ISSUER_DISABLED", true);
    const intent = await repository.getIntent(request.body.intentId ?? "");
    if (!intent) return error(reply, 404, "INTENT_NOT_FOUND");
    try {
      const credential = publicDemoRunner.issueDemoPaymentCredential({
        sessionId: request.body.sessionId ?? "",
        usageCapAtomic: intent.policy.constraints.usageCapAtomic,
      });
      reply.header("cache-control", "no-store");
      return {
        credential,
        usageCapAtomic: intent.policy.constraints.usageCapAtomic,
        mode: "HMAC_DEMO_BRIDGE",
        warning: "Devnet onboarding only. This is not a live pay.sh payment credential.",
      };
    } catch (cause) {
      return error(reply, 400, cause instanceof Error ? cause.message : "DEVNET_CREDENTIAL_FAILED");
    }
  });

  app.post<{ Body: IntentBody }>("/v1/intents", { schema: { body: { $ref: "IntentRequest#" } } }, async (request, reply) => {
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

  app.post<{ Body: { intentId: string; sessionId: string } }>("/v1/payment-challenges", { schema: { body: { $ref: "PaymentChallengeRequest#" } } }, async (request, reply) => {
    const intent = await repository.getIntent(request.body?.intentId);
    if (!intent) return error(reply, 404, "INTENT_NOT_FOUND");
    const sessionId = request.body?.sessionId;
    if (!sessionId || !/^ses_[A-Za-z0-9_-]{4,124}$/.test(sessionId)) {
      return error(reply, 400, "SESSION_ID_INVALID");
    }
    if (await repository.getSession(sessionId)) return error(reply, 409, "SESSION_ID_EXISTS");
    const challenge = await payment.createChallenge({
      sessionId,
      usageCapAtomic: intent.policy.constraints.usageCapAtomic,
    });
    if (challenge.status !== "CONFIRMED" || !challenge.challenge) {
      return error(
        reply,
        challenge.retryable ? 503 : 402,
        challenge.failureCode ?? "PAYMENT_CHALLENGE_FAILED",
        challenge.retryable,
      );
    }
    return {
      sessionId,
      usageCapAtomic: intent.policy.constraints.usageCapAtomic,
      challenge: challenge.challenge,
      ...(challenge.providerReference ? { providerReference: challenge.providerReference } : {}),
      ...(challenge.fixtureMarker ? { fixtureMarker: challenge.fixtureMarker } : {}),
      paymentInstruction: PAYMENT_INSTRUCTION,
    };
  });

  app.post<{ Body: SessionBody }>("/v1/sessions", { schema: { body: { $ref: "SessionRequest#" } } }, async (request, reply) => {
    const traceId = String(request.headers["x-trace-id"]);
    const idempotencyKey = String(request.headers["idempotency-key"] ?? "");
    if (!idempotencyKey) return error(reply, 400, "IDEMPOTENCY_KEY_REQUIRED");
    const fingerprint = sha256Hash({ intentId: request.body?.intentId, policyHash: request.body?.policyHash, sessionId: request.body?.sessionId ?? null, paymentCredential: request.body?.paymentCredential ?? null, paymentChallenge: request.body?.paymentChallenge ?? null, bondAccount: request.body?.bondAccount ?? null });
    const claim = await repository.claimIdempotent("create-session", idempotencyKey, fingerprint);
    if (claim.status === "CONFLICT") return error(reply, 409, "IDEMPOTENCY_KEY_CONFLICT");
    if (claim.status === "IN_PROGRESS") return error(reply, 409, "IDEMPOTENCY_IN_PROGRESS", true);
    if (claim.status === "COMPLETED") return claim.value;
    const abortSessionCreation = async (statusCode: number, code: string, retryable = false, sessionId?: string): Promise<FastifyReply> => {
      if (sessionId) {
        await repository.deleteSessionIfState(sessionId, ["CREATED", "POLICY_READY", "PAYMENT_READY", "BONDED"]);
      }
      await repository.releaseIdempotent("create-session", idempotencyKey, fingerprint);
      return error(reply, statusCode, code, retryable);
    };
    try {
      const intent = await repository.getIntent(request.body?.intentId);
      if (!intent) return await abortSessionCreation(404, "INTENT_NOT_FOUND");
      if (intent.policyHash !== request.body.policyHash) return await abortSessionCreation(409, "POLICY_HASH_MISMATCH");
    const sessionId = request.body.sessionId ?? `ses_${randomUUID()}`;
    if (request.body.sessionId && !/^ses_[A-Za-z0-9_-]{4,124}$/.test(request.body.sessionId)) {
      return await abortSessionCreation(400, "SESSION_ID_INVALID");
    }
    if (await repository.getSession(sessionId)) return await abortSessionCreation(409, "SESSION_ID_EXISTS");
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
    const created = await repository.createSession(session);
    if (!created) return await abortSessionCreation(409, "SESSION_ID_EXISTS");
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
    const verification = await payment.verifyCredential({
      sessionId,
      credential: request.body.paymentCredential ?? "",
      ...(request.body.paymentChallenge ? { challenge: request.body.paymentChallenge } : {}),
    });
    if (verification.status !== "CONFIRMED") return await abortSessionCreation(verification.retryable ? 503 : 402, verification.failureCode ?? "PAYMENT_NOT_CONFIRMED", verification.retryable, sessionId);
    if (verification.usageLimitAtomic === undefined || BigInt(verification.usageLimitAtomic) < BigInt(intent.policy.constraints.usageCapAtomic)) {
      return await abortSessionCreation(402, "PAYMENT_CAP_INSUFFICIENT", false, sessionId);
    }
    session = await repository.transitionSession(sessionId, "POLICY_READY", "PAYMENT_READY");
    if (verification.providerReference) session.paymentReference = verification.providerReference;
    await repository.saveSession(session);
    await emit(sessionId, "PAYMENT_VERIFIED", traceId, {
      status: verification.status,
      mode: "PAY_PER_USE_BOUNDED",
      usageCapAtomic: intent.policy.constraints.usageCapAtomic,
      ...(verification.providerReference ? { providerReference: verification.providerReference } : {}),
      ...(verification.fixtureMarker ? { fixtureMarker: verification.fixtureMarker } : {}),
    });
    if (intent.policy.bondedActions.length > 0) {
      if (!request.body.bondAccount) return await abortSessionCreation(402, "BOND_REQUIRED", false, sessionId);
      const result = await bond.verifyOpenBond({ sessionId, bondAccount: request.body.bondAccount, policyHash: intent.policyHash, amountAtomic: intent.policy.constraints.bondAmountAtomic, maxPenaltyAtomic: intent.policy.constraints.maxPenaltyAtomic });
      if (result.status !== "CONFIRMED") return await abortSessionCreation(result.retryable ? 503 : 402, result.failureCode ?? "BOND_NOT_CONFIRMED", result.retryable, sessionId);
      session = await repository.transitionSession(sessionId, "PAYMENT_READY", "BONDED");
      if (result.providerReference) session.bondReference = result.providerReference;
      await repository.saveSession(session);
      await emit(sessionId, "BOND_OPENED", traceId, {
        status: result.status,
        bondAmountAtomic: intent.policy.constraints.bondAmountAtomic,
        maxPenaltyAtomic: intent.policy.constraints.maxPenaltyAtomic,
        ...(result.providerReference ? { bondAccount: result.providerReference } : {}),
        ...(result.fixtureMarker ? { fixtureMarker: result.fixtureMarker } : {}),
      });
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
    const token = parseSessionToken(request);
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
        await emit(sessionId, "REQUEST_DENIED", traceId, {
          path,
          method: request.method,
          reason: code,
          penaltyAtomic: "0",
          reachedUpstream: false,
          protectedDataExposed: false,
        });
      }
      error(reply, status, code);
      return undefined;
    };
    if (!session) return deny(404, "SESSION_NOT_FOUND");
    const idempotentExpire = session.state === "EXPIRED" && request.method === "POST" && /^\/reservations\/[^/]+\/expire$/.test(path);
    if (session.state !== "ACTIVE" && !idempotentExpire) return deny(403, "SESSION_NOT_ACTIVE");
    const token = parseSessionToken(request);
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
    let reservationInput: { productId: string; quantity: number } | undefined;
    if (request.method === "POST" && path === "/reservations") {
      const body = request.body as { productId?: unknown; quantity?: unknown } | null;
      if (
        !body
        || typeof body !== "object"
        || Object.keys(body).some((entry) => !["productId", "quantity"].includes(entry))
        || typeof body.productId !== "string"
        || body.productId.length === 0
        || (body.quantity !== undefined && (typeof body.quantity !== "number" || !Number.isInteger(body.quantity) || body.quantity < 1))
      ) return error(reply, 400, "INVALID_RESERVATION_REQUEST");
      reservationInput = { productId: body.productId, quantity: body.quantity ?? 1 };
    }
    if (!/^POST \/reservations\/[^/]+\/expire$/.test(`${request.method} ${path}`)) {
      try {
        const reserved = await repository.reserveRequest(session.sessionId, { operationKey: key, operationMaxCalls: operation.maxCalls, maxTotalCalls: policy.constraints.maxTotalCalls, maxRequestsPerMinute: policy.constraints.maxRequestsPerMinute, nowMs: clock.now().getTime(), expectedState: "ACTIVE" });
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
    let expiryPenaltyEventData: Record<string, unknown> | undefined;
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
          const action = policy.bondedActions.find((entry) => entry.operationId === "reserve-inventory");
          if (!action || !reservationInput) return error(reply, 400, "INVALID_RESERVATION_REQUEST");
          payload = await commerce.createReservation(session.sessionId, reservationInput.productId, reservationInput.quantity, action.ttlSeconds);
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
            const locked = await repository.transitionSession(session.sessionId, "ACTIVE", "SETTLING").catch(() => null);
            if (!locked) return error(reply, 409, "SESSION_SETTLEMENT_IN_PROGRESS");
            const unlock = async (): Promise<void> => {
              await repository.transitionSession(session.sessionId, "SETTLING", "ACTIVE").catch(() => undefined);
            };
            try {
              const reserved = await repository.reserveRequest(session.sessionId, { operationKey: key, operationMaxCalls: operation.maxCalls, maxTotalCalls: policy.constraints.maxTotalCalls, maxRequestsPerMinute: policy.constraints.maxRequestsPerMinute, nowMs: clock.now().getTime(), expectedState: "SETTLING" });
              session.calls = reserved.calls;
              session.operationCalls = reserved.operationCalls;
              session.requestTimestamps = reserved.requestTimestamps;
            } catch (cause) {
              const code = cause instanceof Error ? cause.message : "REQUEST_RESERVATION_FAILED";
              if (["OPERATION_CALL_LIMIT", "TOTAL_CALL_LIMIT", "RATE_LIMIT"].includes(code)) {
                await unlock();
                return error(reply, 429, code);
              }
              throw cause;
            }
            const action = policy.bondedActions[0];
            if (!action) {
              await unlock();
              return error(reply, 409, "BONDED_ACTION_MISSING");
            }
            expiryUsage = await payment.getUsageSettlement({ sessionId: session.sessionId, calls: session.calls, usageCapAtomic: policy.constraints.usageCapAtomic });
            if (expiryUsage.status !== "CONFIRMED") {
              await unlock();
              return error(reply, 503, expiryUsage.failureCode ?? "USAGE_SETTLEMENT_PENDING", true);
            }
            const usageChargedAtomic = validateUsageSettlement(expiryUsage, policy.constraints.usageCapAtomic);
            expiryUsageChargedAtomic = usageChargedAtomic;
            const penaltyAtomic = action.expiryPenaltyAtomic;
            const bondRefundedAtomic = (BigInt(policy.constraints.bondAmountAtomic) - BigInt(penaltyAtomic)).toString();
            const createdEvidence = createSettlementEvidence({ sessionId: session.sessionId, policyHash: session.policyHash, reservationId: prepared.reservationId, outcome: "EXPIRED_RESERVATION", usageChargedAtomic, penaltyAtomic, bondRefundedAtomic, nonce: `expiry:${prepared.reservationId}`, issuedAt: clock.now().toISOString(), authority: settlementAuthority }, settlementSigningSecret);
            let expiryAttempt = await getOrCreateSettlementAttempt(repository, clock, {
              attemptId: expiryAttemptId(session.sessionId, prepared.reservationId),
              sessionId: session.sessionId,
              outcome: "EXPIRED_RESERVATION",
              reservationId: prepared.reservationId,
              evidence: createdEvidence,
            });
            await claimSettlementEvidenceNonce(repository, expiryAttempt);
      expirySettlement = await bond.requestExpiredReservationSettlement({ sessionId: session.sessionId, ...(session.bondReference ? { bondAccount: session.bondReference } : {}), policyHash: session.policyHash, penaltyAtomic, maxPenaltyAtomic: policy.constraints.maxPenaltyAtomic, bondAmountAtomic: policy.constraints.bondAmountAtomic, reservationId: prepared.reservationId, evidence: expiryAttempt.evidence });
            expiryAttempt = await updateSettlementAttempt(repository, clock, expiryAttempt, expirySettlement);
            expirySettlement = await pollSettlement(bond, expirySettlement, options.settlementPolling);
            await updateSettlementAttempt(repository, clock, expiryAttempt, expirySettlement);
            if (expirySettlement.status !== "CONFIRMED") {
              await unlock();
              return error(reply, expirySettlement.retryable ? 503 : 409, expirySettlement.failureCode ?? "EXPIRY_SETTLEMENT_NOT_CONFIRMED", expirySettlement.retryable);
            }
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
            expiryPenaltyEventData = {
              status: expirySettlement.status,
              penaltyAtomic: settledAmounts.penaltyAtomic,
              bondRefundedAtomic: settledAmounts.bondRefundedAtomic,
              ...(expirySettlement.providerReference ? { providerReference: expirySettlement.providerReference } : {}),
              ...(expirySettlement.fixtureMarker ? { fixtureMarker: expirySettlement.fixtureMarker } : {}),
            };
          }
        } else return error(reply, 404, "UPSTREAM_OPERATION_NOT_IMPLEMENTED");
      }
    } catch (cause) {
      await repository.transitionSession(session.sessionId, "SETTLING", "ACTIVE").catch(() => undefined);
      if (cause instanceof CommerceError) return error(reply, 409, cause.code);
      throw cause;
    }
    if (countRequest) {
      const eventData: Record<string, unknown> = { method: request.method, path, callIndex: session.calls };
      if (eventType === "REQUEST_ALLOWED") eventData.chargedAtomic = DEFAULT_UNIT_PRICE_ATOMIC;
      if (payload && typeof payload === "object") {
        const reservation = payload as Partial<ReservationRecord>;
        if (reservation.reservationId) eventData.reservationId = reservation.reservationId;
        if (reservation.productId) eventData.productId = reservation.productId;
        if (reservation.expiresAt) eventData.expiresAt = reservation.expiresAt;
      }
      await emit(session.sessionId, eventType, traceId, eventData);
    }
    if (eventType === "RESERVATION_EXPIRED" && expirySettlement && expiryUsage && expiryUsageChargedAtomic && expirySettledAmounts && expiryPenaltyEventData) {
      await emit(session.sessionId, "PENALTY_SETTLED", traceId, expiryPenaltyEventData);
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
      const expiredSession = await repository.transitionSession(session.sessionId, "SETTLING", "EXPIRED");
      expiredSession.receipt = { ...receiptBody, receiptHash: sha256Hash(receiptBody) };
      await repository.saveSession(expiredSession);
      await emit(session.sessionId, "SESSION_CLOSED", traceId, {
        outcome: "EXPIRED",
        receiptHash: expiredSession.receipt.receiptHash,
      });
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
    const activeSession = session;
    const closeFingerprint = sha256Hash({ sessionId, policyHash: activeSession.policyHash, action: "close" });
    const closeClaim = await repository.claimIdempotent(`close:${sessionId}`, key, closeFingerprint);
    if (closeClaim.status === "CONFLICT") return error(reply, 409, "IDEMPOTENCY_KEY_CONFLICT");
    if (closeClaim.status === "IN_PROGRESS") return error(reply, 409, "IDEMPOTENCY_IN_PROGRESS", true);
    if (closeClaim.status === "COMPLETED") return closeClaim.value;
    const abortClose = async (statusCode: number, code: string, retryable = false): Promise<FastifyReply> => {
      await repository.releaseIdempotent(`close:${sessionId}`, key, closeFingerprint);
      return error(reply, statusCode, code, retryable);
    };
    try {
    if (activeSession.receipt) return await abortClose(409, "IDEMPOTENCY_KEY_CONFLICT");
    if (activeSession.state !== "ACTIVE" && activeSession.state !== "SETTLING") {
      return await abortClose(409, "INVALID_STATE_TRANSITION");
    }
    const activeReservations = (await repository.listReservations(sessionId)).filter((record) => record.state === "ACTIVE");
    if (activeReservations.length > 0) return await abortClose(409, "ACTIVE_RESERVATION_EXISTS");
    session = await repository.claimSettlement(
      sessionId,
      clock.now(),
      DEFAULT_SETTLEMENT_LEASE_MS,
    );
    if (!session) return await abortClose(409, "SESSION_SETTLEMENT_IN_PROGRESS");
    const abortLockedClose = async (statusCode: number, code: string, retryable = false): Promise<FastifyReply> => {
      await repository.transitionSession(sessionId, "SETTLING", "ACTIVE").catch(() => undefined);
      return await abortClose(statusCode, code, retryable);
    };
    const usage = await payment.getUsageSettlement({ sessionId, calls: session.calls, usageCapAtomic: session.policy.constraints.usageCapAtomic });
    if (usage.status !== "CONFIRMED") return await abortLockedClose(503, usage.failureCode ?? "USAGE_SETTLEMENT_PENDING", true);
    let usageChargedAtomic: string;
    try {
      usageChargedAtomic = validateUsageSettlement(usage, session.policy.constraints.usageCapAtomic);
    } catch {
      return await abortLockedClose(502, "INVALID_USAGE_SETTLEMENT");
    }
    await emit(sessionId, "USAGE_SETTLED", traceId, { calls: session.calls, usageChargedAtomic, fixtureMarker: usage.fixtureMarker });
    let bondRefundedAtomic = "0";
    let bondReference: string | undefined;
    let bondResultMarker: "FAKE_ADAPTER_FIXTURE" | undefined;
    if (session.policy.bondedActions.length > 0) {
      const createdEvidence = createSettlementEvidence({ sessionId, policyHash: session.policyHash, outcome: "VALID_CLOSE", usageChargedAtomic, penaltyAtomic: "0", bondRefundedAtomic: session.policy.constraints.bondAmountAtomic, nonce: `close:${sessionId}`, issuedAt: clock.now().toISOString(), authority: settlementAuthority }, settlementSigningSecret);
      let closeAttempt = await getOrCreateSettlementAttempt(repository, clock, {
        attemptId: closeAttemptId(sessionId),
        sessionId,
        outcome: "VALID_CLOSE",
        evidence: createdEvidence,
      });
      await claimSettlementEvidenceNonce(repository, closeAttempt);
      let result = await bond.requestValidClose({ sessionId, ...(session.bondReference ? { bondAccount: session.bondReference } : {}), policyHash: session.policyHash, amountAtomic: session.policy.constraints.bondAmountAtomic, evidence: closeAttempt.evidence });
      closeAttempt = await updateSettlementAttempt(repository, clock, closeAttempt, result);
      result = await pollSettlement(bond, result, options.settlementPolling);
      await updateSettlementAttempt(repository, clock, closeAttempt, result);
      if (result.status !== "CONFIRMED") return await abortLockedClose(503, result.failureCode ?? "BOND_CLOSE_PENDING", true);
      let settledAmounts: { bondRefundedAtomic: string; penaltyAtomic: string };
      try {
        settledAmounts = validateValidCloseSettlement(result, session.policy.constraints.bondAmountAtomic);
      } catch {
        return await abortLockedClose(502, "INVALID_BOND_SETTLEMENT");
      }
      bondRefundedAtomic = settledAmounts.bondRefundedAtomic;
      bondReference = result.providerReference;
      if (result.fixtureMarker) bondResultMarker = result.fixtureMarker;
      await emit(sessionId, "BOND_REFUNDED", traceId, {
        status: result.status,
        bondRefundedAtomic,
        penaltyAtomic: "0",
        ...(result.providerReference ? { providerReference: result.providerReference } : {}),
        ...(result.fixtureMarker ? { fixtureMarker: result.fixtureMarker } : {}),
      });
    }
    session = await repository.transitionSession(sessionId, "SETTLING", "CLOSED");
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
    await emit(sessionId, "SESSION_CLOSED", traceId, { outcome: "CLOSED", receiptHash: receipt.receiptHash });
    await repository.completeIdempotent(`close:${sessionId}`, key, closeFingerprint, receipt);
    return receipt;
    } catch (cause) {
      await repository.transitionSession(sessionId, "SETTLING", "ACTIVE").catch(() => undefined);
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
