import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import {
  BotBondClient,
  CappedSessionPaymentAdapter,
  SolanaBondAdapter,
} from "@botbond/payment-client";
import { DEFAULT_UNIT_PRICE_ATOMIC } from "@botbond/contracts";
import type {
  AdapterResult,
  BondAdapter,
  BondSettlementResult,
  BondVerificationResult,
  PaymentAdapter,
  PaymentChallengeResult,
  PaymentVerificationResult,
  UsageSettlementResult,
} from "@botbond/contracts";

const MARKER = "FAKE_ADAPTER_FIXTURE" as const;
const require = createRequire(import.meta.url);

export function loadBotBondIdl(): anchor.Idl {
  let packagedIdl: string | undefined;
  try {
    packagedIdl = require.resolve("@botbond/payment-client/idl/botbond.json");
  } catch {
    packagedIdl = undefined;
  }
  const candidates: Array<string | URL> = [
    ...(process.env.BOTBOND_IDL_PATH ? [process.env.BOTBOND_IDL_PATH] : []),
    ...(packagedIdl ? [packagedIdl] : []),
    new URL("../../../target/idl/botbond.json", import.meta.url),
    new URL("../../../../target/idl/botbond.json", import.meta.url),
  ];
  const idlPath = candidates.find((candidate) => existsSync(candidate));
  if (!idlPath) throw new Error("BOTBOND_IDL_NOT_FOUND");
  return JSON.parse(readFileSync(idlPath, "utf8")) as anchor.Idl;
}

export class FixtureMarkedPaymentAdapter implements PaymentAdapter {
  constructor(private readonly delegate: PaymentAdapter) {}

  private marked<T extends AdapterResult>(result: T): T {
    return { ...result, fixtureMarker: MARKER };
  }

  async createChallenge(input: { sessionId: string; usageCapAtomic: string }): Promise<PaymentChallengeResult> {
    return this.marked(await this.delegate.createChallenge(input));
  }

  async verifyCredential(input: { sessionId: string; credential: string; challenge?: string }): Promise<PaymentVerificationResult> {
    return this.marked(await this.delegate.verifyCredential(input));
  }

  async getUsageSettlement(input: { sessionId: string; calls: number; usageCapAtomic: string }): Promise<UsageSettlementResult> {
    return this.marked(await this.delegate.getUsageSettlement(input));
  }
}

export class FakePaymentAdapter implements PaymentAdapter {
  constructor(private readonly options: { failCredential?: boolean; usagePerCallAtomic?: bigint } = {}) {}

  async createChallenge(input: { sessionId: string; usageCapAtomic: string }): Promise<PaymentChallengeResult> {
    return { status: "CONFIRMED", retryable: false, challenge: `fake-challenge:${input.sessionId}`, fixtureMarker: MARKER };
  }

  async verifyCredential(input: { sessionId: string; credential: string }): Promise<PaymentVerificationResult> {
    if (this.options.failCredential || input.credential !== "fake-payment-ok") {
      return { status: "FAILED", retryable: false, failureCode: "PAYMENT_CREDENTIAL_INVALID", fixtureMarker: MARKER };
    }
    return {
      status: "CONFIRMED",
      retryable: false,
      usageLimitAtomic: "200000",
      providerReference: `fake-payment:${input.sessionId}`,
      fixtureMarker: MARKER,
    };
  }

  async getUsageSettlement(input: { sessionId: string; calls: number; usageCapAtomic: string }): Promise<UsageSettlementResult> {
    const perCall = this.options.usagePerCallAtomic ?? 1000n;
    const charged = perCall * BigInt(input.calls);
    const capped = charged > BigInt(input.usageCapAtomic) ? BigInt(input.usageCapAtomic) : charged;
    return {
      status: "CONFIRMED",
      retryable: false,
      usageChargedAtomic: capped.toString(),
      providerReference: `fake-usage:${input.sessionId}`,
      fixtureMarker: MARKER,
    };
  }
}

export class FakeBondAdapter implements BondAdapter {
  public readonly validCloseRequests: string[] = [];
  public readonly expirySettlementRequests: Array<{ sessionId: string; penaltyAtomic: string }> = [];

  constructor(private readonly options: { failVerification?: boolean } = {}) {}

  async verifyOpenBond(input: { sessionId: string; bondAccount: string; policyHash: string; amountAtomic: string; maxPenaltyAtomic: string }): Promise<BondVerificationResult> {
    if (this.options.failVerification || input.bondAccount !== "fake-bond-ok") {
      return { status: "FAILED", retryable: false, failureCode: "BOND_NOT_CONFIRMED", fixtureMarker: MARKER };
    }
    return {
      status: "CONFIRMED",
      retryable: false,
      bondAmountAtomic: input.amountAtomic,
      maxPenaltyAtomic: input.maxPenaltyAtomic,
      providerReference: `fake-bond:${input.sessionId}`,
      fixtureMarker: MARKER,
    };
  }

  async requestValidClose(input: { sessionId: string; amountAtomic: string }): Promise<BondSettlementResult> {
    if (!this.validCloseRequests.includes(input.sessionId)) this.validCloseRequests.push(input.sessionId);
    return {
      status: "CONFIRMED",
      retryable: false,
      bondRefundedAtomic: input.amountAtomic,
      penaltyAtomic: "0",
      providerReference: `fake-bond-refund:${input.sessionId}`,
      fixtureMarker: MARKER,
    };
  }

  async requestExpiredReservationSettlement(input: { sessionId: string; penaltyAtomic: string; maxPenaltyAtomic: string; bondAmountAtomic: string }): Promise<BondSettlementResult> {
    const penalty = BigInt(input.penaltyAtomic);
    const bounded = [penalty, BigInt(input.maxPenaltyAtomic), BigInt(input.bondAmountAtomic)].reduce((minimum, value) => value < minimum ? value : minimum);
    if (!this.expirySettlementRequests.some((request) => request.sessionId === input.sessionId)) {
      this.expirySettlementRequests.push({ sessionId: input.sessionId, penaltyAtomic: bounded.toString() });
    }
    return {
      status: "CONFIRMED",
      retryable: false,
      bondRefundedAtomic: (BigInt(input.bondAmountAtomic) - bounded).toString(),
      penaltyAtomic: bounded.toString(),
      providerReference: `fake-bond-expiry:${input.sessionId}`,
      fixtureMarker: MARKER,
    };
  }

  async getTransactionStatus(input: { providerReference: string }): Promise<AdapterResult> {
    return { status: "CONFIRMED", retryable: false, providerReference: input.providerReference, fixtureMarker: MARKER };
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

export function adaptersFromEnvironment(): { payment: PaymentAdapter; bond: BondAdapter } {
  const mode = process.env.ADAPTER_MODE ?? "fake";
  if (mode === "fake") return { payment: new FakePaymentAdapter(), bond: new FakeBondAdapter() };
  if (mode !== "solana") throw new Error(`UNSUPPORTED_ADAPTER_MODE:${mode}`);

  const rpcUrl = requiredEnvironment("ANCHOR_PROVIDER_URL");
  const walletPath = requiredEnvironment("ANCHOR_WALLET");
  const evidenceSecret = requiredEnvironment("BOTBOND_EVIDENCE_SECRET");
  const paymentSecret = requiredEnvironment("BOTBOND_PAYMENT_SECRET");
  const walletBytes = JSON.parse(readFileSync(walletPath, "utf8")) as number[];
  const settlementAuthority = Keypair.fromSecretKey(Uint8Array.from(walletBytes));
  const wallet = new anchor.Wallet(settlementAuthority);
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new anchor.Program(loadBotBondIdl(), provider);
  const cluster = process.env.SOLANA_CLUSTER ?? (rpcUrl.includes("devnet") ? "devnet" : "custom");
  const client = new BotBondClient(program, cluster);

  return {
    payment: new FixtureMarkedPaymentAdapter(
      new CappedSessionPaymentAdapter({
        hmacSecret: paymentSecret,
        unitPriceAtomic: DEFAULT_UNIT_PRICE_ATOMIC,
      }),
    ),
    bond: new SolanaBondAdapter({
      client,
      settlementAuthority,
      evidenceHmacSecret: evidenceSecret,
    }),
  };
}
