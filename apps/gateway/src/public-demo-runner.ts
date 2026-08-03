import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Firestore } from "@google-cloud/firestore";
import {
  createAssociatedTokenAccountIdempotent,
  mintTo,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  BotBondClient,
  CappedSessionPaymentAdapter,
  explorerTxUrl,
} from "@botbond/payment-client";
import { loadBotBondIdl } from "./adapters.js";

export const PUBLIC_DEMO_BEHAVIORS = ["normal", "scope-denied", "abandon"] as const;
export type PublicDemoBehavior = (typeof PUBLIC_DEMO_BEHAVIORS)[number];

export interface GatewayInjection {
  statusCode: number;
  body: string;
}

export interface PublicDemoRun {
  runId: string;
  behavior: PublicDemoBehavior;
  sessionId: string;
  token: string;
  expiresAt: string;
  eventStream: string;
  policyHash: string;
  bondAccount: string;
  openTransaction: {
    signature: string;
    explorerUrl: string;
    cluster: string;
    status: "CONFIRMED";
  };
  execution: {
    bond: "LIVE_SOLANA_DEVNET";
    intentCompiler: "VERTEX_AI" | "FAKE";
    usagePayment: "HMAC_DEMO_BRIDGE";
    sponsored: true;
  };
}

export interface PublicDemoRunner {
  createRun(input: {
    behavior: PublicDemoBehavior;
    clientFingerprint: string;
    inject: (input: {
      method: "POST";
      url: string;
      headers?: Record<string, string>;
      payload: Record<string, unknown>;
    }) => Promise<GatewayInjection>;
  }): Promise<PublicDemoRun>;
  issueDemoPaymentCredential(input: { sessionId: string; usageCapAtomic: string }): string;
}

type QuotaLease = { runId: string; release(): Promise<void> };

class FirestorePublicDemoQuota {
  constructor(
    private readonly firestore: Firestore,
    private readonly namespace: string,
    private readonly dailyLimit: number,
    private readonly cooldownMs: number,
    private readonly leaseMs: number,
  ) {}

  async claim(clientFingerprint: string): Promise<QuotaLease> {
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const runId = `run_${randomUUID()}`;
    const collection = this.firestore.collection(`${this.namespace}_publicDemoQuota`);
    const daily = collection.doc(`daily-${day}`);
    const client = collection.doc(`client-${clientFingerprint}`);
    const lease = collection.doc("active-lease");

    await this.firestore.runTransaction(async (transaction) => {
      const [dailySnapshot, clientSnapshot, leaseSnapshot] = await Promise.all([
        transaction.get(daily),
        transaction.get(client),
        transaction.get(lease),
      ]);
      const used = Number(dailySnapshot.data()?.used ?? 0);
      const lastRunAt = Number(clientSnapshot.data()?.lastRunAt ?? 0);
      const leaseExpiresAt = Number(leaseSnapshot.data()?.expiresAt ?? 0);
      if (used >= this.dailyLimit) throw new Error("PUBLIC_DEMO_DAILY_LIMIT");
      if (this.cooldownMs > 0 && now - lastRunAt < this.cooldownMs) throw new Error("PUBLIC_DEMO_COOLDOWN");
      if (leaseExpiresAt > now) throw new Error("PUBLIC_DEMO_BUSY");
      transaction.set(daily, { day, used: used + 1, updatedAt: now });
      transaction.set(client, { lastRunAt: now });
      transaction.set(lease, { runId, expiresAt: now + this.leaseMs });
    });

    return {
      runId,
      release: async () => {
        await this.firestore.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(lease);
          if (snapshot.data()?.runId === runId) transaction.delete(lease);
        });
      },
    };
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function parseJson<T>(result: GatewayInjection, operation: string): T {
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`${operation}_FAILED:${result.statusCode}:${result.body}`);
  }
  return JSON.parse(result.body) as T;
}

class SolanaPublicDemoRunner implements PublicDemoRunner {
  private readonly connection: Connection;
  private readonly payer: Keypair;
  private readonly merchant: PublicKey;
  private readonly mint: PublicKey;
  private readonly client: BotBondClient;
  private readonly payment: CappedSessionPaymentAdapter;

  constructor(
    private readonly quota: FirestorePublicDemoQuota,
    rpcUrl: string,
    walletPath: string,
    merchant: string,
    mint: string,
    paymentSecret: string,
  ) {
    const walletBytes = JSON.parse(readFileSync(walletPath, "utf8")) as number[];
    this.payer = Keypair.fromSecretKey(Uint8Array.from(walletBytes));
    this.merchant = new PublicKey(merchant);
    this.mint = new PublicKey(mint);
    this.connection = new Connection(rpcUrl, "confirmed");
    const provider = new anchor.AnchorProvider(
      this.connection,
      new anchor.Wallet(this.payer),
      { commitment: "confirmed" },
    );
    this.client = new BotBondClient(new anchor.Program(loadBotBondIdl(), provider), "devnet");
    this.payment = new CappedSessionPaymentAdapter({ hmacSecret: paymentSecret });
  }

  async createRun(input: Parameters<PublicDemoRunner["createRun"]>[0]): Promise<PublicDemoRun> {
    const lease = await this.quota.claim(input.clientFingerprint);
    try {
      const task = "Compare laptop price and live inventory, reserve the best last unit, release it after the comparison, and do not access seller contacts or customer reviews.";
      const intent = parseJson<{
        intentId: string;
        policyHash: string;
        policy: {
          constraints: {
            usageCapAtomic: string;
            bondAmountAtomic: string;
            maxPenaltyAtomic: string;
            expiresAt: string;
          };
          bondedActions: Array<{ ttlSeconds: number }>;
        };
        validationMetadata: { compilerMode: "VERTEX_AI" | "FAKE" };
      }>(await input.inject({
        method: "POST",
        url: "/v1/intents",
        payload: {
          task,
          agentWallet: this.payer.publicKey.toBase58(),
          // Keep the sponsored video path within the three-minute submission
          // limit even when Gemini proposes the merchant's longer default TTL.
          budget: {
            usageCapAtomic: "200000",
            bondCapAtomic: "1000000",
            maxSessionTtlSeconds: 60,
          },
        },
      }), "PUBLIC_DEMO_INTENT");
      if (intent.policy.bondedActions.length === 0) throw new Error("PUBLIC_DEMO_BONDED_POLICY_REQUIRED");

      const agentToken = await createAssociatedTokenAccountIdempotent(
        this.connection,
        this.payer,
        this.mint,
        this.payer.publicKey,
      );
      await createAssociatedTokenAccountIdempotent(
        this.connection,
        this.payer,
        this.mint,
        this.merchant,
      );
      await mintTo(
        this.connection,
        this.payer,
        this.mint,
        agentToken,
        this.payer,
        BigInt(intent.policy.constraints.bondAmountAtomic),
      );

      const hashBytes = Uint8Array.from(Buffer.from(intent.policyHash.slice("sha256:".length), "hex"));
      const nonce = BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));
      const opened = await this.client.openBond({
        agent: this.payer,
        merchant: this.merchant,
        settlementAuthority: this.payer.publicKey,
        mint: this.mint,
        policyHash: hashBytes,
        sessionNonce: nonce,
        bondAmountAtomic: BigInt(intent.policy.constraints.bondAmountAtomic),
        maxPenaltyAtomic: BigInt(intent.policy.constraints.maxPenaltyAtomic),
        expiresAt: new Date(intent.policy.constraints.expiresAt),
      });

      const sessionId = `ses_public_${randomUUID()}`;
      const challenge = parseJson<{ challenge: string }>(await input.inject({
        method: "POST",
        url: "/v1/payment-challenges",
        payload: { intentId: intent.intentId, sessionId },
      }), "PUBLIC_DEMO_PAYMENT_CHALLENGE");
      const paymentCredential = this.payment.issueCredential(
        sessionId,
        intent.policy.constraints.usageCapAtomic,
      );
      const session = parseJson<{ sessionId: string; token: string; expiresAt: string; eventStream: string }>(await input.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { "idempotency-key": `public-${lease.runId}` },
        payload: {
          sessionId,
          intentId: intent.intentId,
          policyHash: intent.policyHash,
          paymentChallenge: challenge.challenge,
          paymentCredential,
          bondAccount: opened.session,
        },
      }), "PUBLIC_DEMO_SESSION");

      return {
        runId: lease.runId,
        behavior: input.behavior,
        sessionId: session.sessionId,
        token: session.token,
        expiresAt: session.expiresAt,
        eventStream: session.eventStream,
        policyHash: intent.policyHash,
        bondAccount: opened.session,
        openTransaction: {
          signature: opened.signature,
          explorerUrl: explorerTxUrl(opened.signature, "devnet"),
          cluster: "devnet",
          status: "CONFIRMED",
        },
        execution: {
          bond: "LIVE_SOLANA_DEVNET",
          intentCompiler: intent.validationMetadata.compilerMode,
          usagePayment: "HMAC_DEMO_BRIDGE",
          sponsored: true,
        },
      };
    } finally {
      await lease.release();
    }
  }

  issueDemoPaymentCredential(input: { sessionId: string; usageCapAtomic: string }): string {
    if (!/^ses_[A-Za-z0-9_-]{4,124}$/.test(input.sessionId)) throw new Error("SESSION_ID_INVALID");
    if (BigInt(input.usageCapAtomic) > 200_000n) throw new Error("PAYMENT_CAP_EXCEEDS_PUBLIC_DEMO_MAX");
    return this.payment.issueCredential(input.sessionId, input.usageCapAtomic);
  }
}

export function publicDemoFingerprint(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export function publicDemoRunnerFromEnvironment(): PublicDemoRunner | undefined {
  if (process.env.PUBLIC_DEMO_ENABLED !== "true") return undefined;
  const projectId = requiredEnvironment("GOOGLE_CLOUD_PROJECT");
  const namespace = process.env.FIRESTORE_NAMESPACE ?? "botbond";
  const quota = new FirestorePublicDemoQuota(
    new Firestore({ projectId }),
    namespace,
    Number(process.env.PUBLIC_DEMO_DAILY_LIMIT ?? 500),
    // The public hackathon demo has no per-IP wait. Daily and single-run
    // limits still protect the sponsored devnet wallet without blocking a reviewer.
    Number(process.env.PUBLIC_DEMO_COOLDOWN_MS ?? 0),
    Number(process.env.PUBLIC_DEMO_LEASE_MS ?? 120_000),
  );
  return new SolanaPublicDemoRunner(
    quota,
    requiredEnvironment("ANCHOR_PROVIDER_URL"),
    requiredEnvironment("ANCHOR_WALLET"),
    requiredEnvironment("PUBLIC_DEMO_MERCHANT"),
    requiredEnvironment("PUBLIC_DEMO_MINT"),
    requiredEnvironment("BOTBOND_PAYMENT_SECRET"),
  );
}
