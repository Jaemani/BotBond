/**
 * BotBond payment client — 역할 C가 A(web)·B(gateway)에 제공하는 안정 인터페이스.
 * docs/03-contracts.md §5 계약 기준. 내부 anchor/web3 세부를 밖으로 흘리지 않는다.
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Signer,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

export type {
  AdapterResult,
  BondAdapter,
  BondSettlementResult,
  BondVerificationResult,
  PaymentAdapter,
  PaymentChallengeResult,
  PaymentVerificationResult,
  SettlementAuthorizationEvidence,
  UsageSettlementResult,
} from "@botbond/contracts";
export * from "./bond-adapter";
export * from "./payment-adapter";
export * from "./policy-hash";

export const BOND_SEED = "bond";

export type BondStatus = "OPEN" | "CLOSED" | "VIOLATED" | "RECLAIMED";

const STATUS_MAP: Record<number, BondStatus> = {
  1: "OPEN",
  2: "CLOSED",
  3: "VIOLATED",
  4: "RECLAIMED",
};

/** A·B가 소비하는 안정된 트랜잭션 결과 형태. 필드 추가는 가능하지만 제거·개명은 CCR. */
export type BondTxResult = {
  signature: string;
  explorerUrl: string;
  session: string;
  slot: number | null;
};

export type BondSessionView = {
  address: string;
  agent: string;
  merchant: string;
  settlementAuthority: string;
  mint: string;
  policyHashHex: string;
  receiptHashHex: string;
  bondAmountAtomic: string;
  maxPenaltyAtomic: string;
  settledPenaltyAtomic: string;
  expiresAt: string; // ISO8601
  sessionNonce: string;
  status: BondStatus;
};

export function explorerTxUrl(signature: string, cluster = "devnet"): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

export function deriveBondPda(
  programId: PublicKey,
  agent: PublicKey,
  policyHash: Uint8Array,
  sessionNonce: bigint
): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(sessionNonce);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(BOND_SEED), agent.toBuffer(), Buffer.from(policyHash), nonceBuf],
    programId
  );
}

export class BotBondClient {
  readonly program: anchor.Program;
  readonly cluster: string;

  constructor(program: anchor.Program, cluster = "devnet") {
    this.program = program;
    this.cluster = cluster;
  }

  get programId(): PublicKey {
    return this.program.programId;
  }

  private ata(mint: PublicKey, owner: PublicKey, allowOffCurve = false): PublicKey {
    return getAssociatedTokenAddressSync(mint, owner, allowOffCurve);
  }

  async openBond(args: {
    agent: Signer;
    merchant: PublicKey;
    settlementAuthority: PublicKey;
    mint: PublicKey;
    policyHash: Uint8Array; // 32 bytes (sha256 of canonical policy JSON)
    sessionNonce: bigint;
    bondAmountAtomic: bigint;
    maxPenaltyAtomic: bigint;
    expiresAt: Date;
  }): Promise<BondTxResult> {
    const [session] = deriveBondPda(
      this.programId,
      args.agent.publicKey,
      args.policyHash,
      args.sessionNonce
    );
    const signature = await this.program.methods
      .openBond(
        Array.from(args.policyHash),
        new anchor.BN(args.sessionNonce.toString()),
        new anchor.BN(args.bondAmountAtomic.toString()),
        new anchor.BN(args.maxPenaltyAtomic.toString()),
        new anchor.BN(Math.floor(args.expiresAt.getTime() / 1000))
      )
      .accounts({
        agent: args.agent.publicKey,
        merchant: args.merchant,
        settlementAuthority: args.settlementAuthority,
        mint: args.mint,
        agentToken: this.ata(args.mint, args.agent.publicKey),
      })
      .signers([args.agent])
      .rpc();
    return this.result(signature, session);
  }

  async closeValid(args: {
    settlementAuthority: Signer;
    session: PublicKey;
    receiptHash: Uint8Array;
  }): Promise<BondTxResult> {
    const bond = await this.fetchRaw(args.session);
    const signature = await this.program.methods
      .closeValid(Array.from(args.receiptHash))
      .accounts({
        settlementAuthority: args.settlementAuthority.publicKey,
        bondSession: args.session,
        mint: bond.mint,
        agentToken: this.ata(bond.mint, bond.agent),
      })
      .signers([args.settlementAuthority])
      .rpc();
    return this.result(signature, args.session);
  }

  async settleViolation(args: {
    settlementAuthority: Signer;
    session: PublicKey;
    receiptHash: Uint8Array;
    penaltyAtomic: bigint;
  }): Promise<BondTxResult> {
    const bond = await this.fetchRaw(args.session);
    const signature = await this.program.methods
      .settleViolation(
        Array.from(args.receiptHash),
        new anchor.BN(args.penaltyAtomic.toString())
      )
      .accounts({
        settlementAuthority: args.settlementAuthority.publicKey,
        bondSession: args.session,
        mint: bond.mint,
        agentToken: this.ata(bond.mint, bond.agent),
        merchantToken: this.ata(bond.mint, bond.merchant),
      })
      .signers([args.settlementAuthority])
      .rpc();
    return this.result(signature, args.session);
  }

  async reclaimExpired(args: {
    agent: Signer;
    session: PublicKey;
  }): Promise<BondTxResult> {
    const bond = await this.fetchRaw(args.session);
    const signature = await this.program.methods
      .reclaimExpired()
      .accounts({
        agent: args.agent.publicKey,
        bondSession: args.session,
        mint: bond.mint,
        agentToken: this.ata(bond.mint, bond.agent),
      })
      .signers([args.agent])
      .rpc();
    return this.result(signature, args.session);
  }

  /** B의 bond 확인·A의 표시용 조회. */
  async fetchBondSession(session: PublicKey): Promise<BondSessionView> {
    const b = await this.fetchRaw(session);
    return {
      address: session.toBase58(),
      agent: b.agent.toBase58(),
      merchant: b.merchant.toBase58(),
      settlementAuthority: b.settlementAuthority.toBase58(),
      mint: b.mint.toBase58(),
      policyHashHex: Buffer.from(b.policyHash).toString("hex"),
      receiptHashHex: Buffer.from(b.receiptHash).toString("hex"),
      bondAmountAtomic: b.bondAmount.toString(),
      maxPenaltyAtomic: b.maxPenalty.toString(),
      settledPenaltyAtomic: b.settledPenalty.toString(),
      expiresAt: new Date(b.expiresAt.toNumber() * 1000).toISOString(),
      sessionNonce: b.sessionNonce.toString(),
      status: STATUS_MAP[b.status] ?? "OPEN",
    };
  }

  private async fetchRaw(session: PublicKey): Promise<any> {
    return (this.program.account as any).bondSession.fetch(session);
  }

  private async result(signature: string, session: PublicKey): Promise<BondTxResult> {
    let slot: number | null = null;
    try {
      const conn: Connection = this.program.provider.connection;
      const status = await conn.getSignatureStatuses([signature]);
      slot = status.value[0]?.slot ?? null;
    } catch {
      slot = null;
    }
    return {
      signature,
      explorerUrl: explorerTxUrl(signature, this.cluster),
      session: session.toBase58(),
      slot,
    };
  }
}
