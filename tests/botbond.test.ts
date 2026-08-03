import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import { BotBondClient, deriveBondPda } from "@botbond/payment-client";

const GRACE_PERIOD_SECONDS = 30;

function randomHash(): Uint8Array {
  const h = new Uint8Array(32);
  for (let i = 0; i < 32; i++) h[i] = Math.floor(Math.random() * 256);
  return h;
}

function future(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

async function expectFail(p: Promise<unknown>, needle: string) {
  try {
    await p;
  } catch (e: any) {
    const msg = `${e}`;
    assert.include(msg, needle, `expected error containing "${needle}", got: ${msg}`);
    return;
  }
  assert.fail(`expected failure containing "${needle}" but tx succeeded`);
}

describe("botbond bond program (docs/03 §5 + §7 invariants)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.botbond as anchor.Program;
  const client = new BotBondClient(program, "custom");

  const payer = (provider.wallet as anchor.Wallet).payer;
  const agent = payer; // fee payer doubles as agent in local tests
  const merchant = Keypair.generate();
  const authority = Keypair.generate();
  const stranger = Keypair.generate();

  let mint: PublicKey;
  let nonceCounter = 1n;

  const BOND = 1_000_000n;
  const MAX_PENALTY = 500_000n;

  async function tokenBalance(owner: PublicKey): Promise<bigint> {
    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      owner
    );
    return (await getAccount(provider.connection, ata.address)).amount;
  }

  async function openSession(opts?: {
    bond?: bigint;
    maxPenalty?: bigint;
    expiresInS?: number;
  }): Promise<{ session: PublicKey; policyHash: Uint8Array; nonce: bigint }> {
    const policyHash = randomHash();
    const nonce = nonceCounter++;
    const res = await client.openBond({
      agent,
      merchant: merchant.publicKey,
      settlementAuthority: authority.publicKey,
      mint,
      policyHash,
      sessionNonce: nonce,
      bondAmountAtomic: opts?.bond ?? BOND,
      maxPenaltyAtomic: opts?.maxPenalty ?? MAX_PENALTY,
      expiresAt: future(opts?.expiresInS ?? 3600),
    });
    return { session: new PublicKey(res.session), policyHash, nonce };
  }

  before(async () => {
    mint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
    const agentAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      agent.publicKey
    );
    await mintTo(
      provider.connection,
      payer,
      mint,
      agentAta.address,
      payer,
      100_000_000n
    );
    // merchant ATA needed for settle_violation destination
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      merchant.publicKey
    );
  });

  it("open_bond escrows the bond and records the policy", async () => {
    const before = await tokenBalance(agent.publicKey);
    const { session, policyHash, nonce } = await openSession();
    const view = await client.fetchBondSession(session);

    assert.equal(view.status, "OPEN");
    assert.equal(view.bondAmountAtomic, BOND.toString());
    assert.equal(view.maxPenaltyAtomic, MAX_PENALTY.toString());
    assert.equal(view.policyHashHex, Buffer.from(policyHash).toString("hex"));
    assert.equal(view.sessionNonce, nonce.toString());

    const [expectedPda] = deriveBondPda(program.programId, agent.publicKey, policyHash, nonce);
    assert.equal(view.address, expectedPda.toBase58());

    const after = await tokenBalance(agent.publicKey);
    assert.equal(before - after, BOND, "bond amount left the agent wallet");
  });

  it("rejects max_penalty > bond_amount (contract test #3)", async () => {
    await expectFail(
      client.openBond({
        agent,
        merchant: merchant.publicKey,
        settlementAuthority: authority.publicKey,
        mint,
        policyHash: randomHash(),
        sessionNonce: nonceCounter++,
        bondAmountAtomic: 100n,
        maxPenaltyAtomic: 101n,
        expiresAt: future(3600),
      }),
      "MaxPenaltyExceedsBond"
    );
  });

  it("rejects expiry in the past", async () => {
    await expectFail(
      client.openBond({
        agent,
        merchant: merchant.publicKey,
        settlementAuthority: authority.publicKey,
        mint,
        policyHash: randomHash(),
        sessionNonce: nonceCounter++,
        bondAmountAtomic: 100n,
        maxPenaltyAtomic: 50n,
        expiresAt: new Date(Date.now() - 60_000),
      }),
      "ExpiryInPast"
    );
  });

  it("only the recorded settlement authority can settle", async () => {
    const { session } = await openSession();
    await expectFail(
      client.closeValid({
        settlementAuthority: stranger,
        session,
        receiptHash: randomHash(),
      }),
      "UnauthorizedSettlement"
    );
  });

  it("close_valid refunds the full bond (contract test #7)", async () => {
    const { session } = await openSession();
    const before = await tokenBalance(agent.publicKey);
    const receipt = randomHash();
    await client.closeValid({ settlementAuthority: authority, session, receiptHash: receipt });

    const view = await client.fetchBondSession(session);
    assert.equal(view.status, "CLOSED");
    assert.equal(view.settledPenaltyAtomic, "0");
    assert.equal(view.receiptHashHex, Buffer.from(receipt).toString("hex"));

    const after = await tokenBalance(agent.publicKey);
    assert.equal(after - before, BOND, "full bond returned to agent");
  });

  it("rejects double settlement (contract test #4)", async () => {
    const { session } = await openSession();
    await client.closeValid({ settlementAuthority: authority, session, receiptHash: randomHash() });
    await expectFail(
      client.closeValid({ settlementAuthority: authority, session, receiptHash: randomHash() }),
      "AlreadySettled"
    );
    await expectFail(
      client.settleViolation({
        settlementAuthority: authority,
        session,
        receiptHash: randomHash(),
        penaltyAtomic: 1n,
      }),
      "AlreadySettled"
    );
  });

  it("settle_violation pays bounded penalty and refunds remainder (contract test #8)", async () => {
    const { session } = await openSession();
    const penalty = 300_000n;
    const agentBefore = await tokenBalance(agent.publicKey);
    const merchantBefore = await tokenBalance(merchant.publicKey);

    await client.settleViolation({
      settlementAuthority: authority,
      session,
      receiptHash: randomHash(),
      penaltyAtomic: penalty,
    });

    const view = await client.fetchBondSession(session);
    assert.equal(view.status, "VIOLATED");
    assert.equal(view.settledPenaltyAtomic, penalty.toString());

    assert.equal(
      (await tokenBalance(merchant.publicKey)) - merchantBefore,
      penalty,
      "merchant received exactly the penalty"
    );
    assert.equal(
      (await tokenBalance(agent.publicKey)) - agentBefore,
      BOND - penalty,
      "agent received the remainder"
    );
  });

  it("rejects penalty > max_penalty", async () => {
    const { session } = await openSession();
    await expectFail(
      client.settleViolation({
        settlementAuthority: authority,
        session,
        receiptHash: randomHash(),
        penaltyAtomic: MAX_PENALTY + 1n,
      }),
      "PenaltyExceedsMax"
    );
    // cleanup so escrow is not left hanging in later balance checks
    await client.closeValid({ settlementAuthority: authority, session, receiptHash: randomHash() });
  });

  it("reclaim is blocked before expiry + grace, allowed after", async function () {
    this.timeout(120_000);
    const { session } = await openSession({ expiresInS: 2 });

    await expectFail(client.reclaimExpired({ agent, session }), "NotYetReclaimable");

    const waitMs = (2 + GRACE_PERIOD_SECONDS + 5) * 1000;
    await new Promise((r) => setTimeout(r, waitMs));

    const before = await tokenBalance(agent.publicKey);
    await client.reclaimExpired({ agent, session });
    const view = await client.fetchBondSession(session);
    assert.equal(view.status, "RECLAIMED");
    assert.equal((await tokenBalance(agent.publicKey)) - before, BOND);
  });
});
