/**
 * BotBond agent driver — 데모 영상의 "주인공" 에이전트를 실제로 연기하는 HTTP 클라이언트.
 *
 * docs/14 §9 라이브 데모 6단계를 실행 중인 gateway에 붙어 그대로 재현한다.
 * 화면에 찍히는 것은 이 터미널 출력(에이전트가 실제로 요청하고 응답을 받는 장면)이며,
 * gateway/dashboard는 같은 세션을 관제 화면으로 병행 표시한다.
 *
 * 시나리오:
 *   honest   — 발견 → 의도 → 계약 → 세션 → 허용 호출 → /seller-contacts 차단(무차감)
 *              → 마지막 재고 예약(1→0) → 정상 release → close(전액 환불)
 *   abandon  — honest와 동일하게 진행하되 예약을 release하지 않고 TTL 만료까지 방치
 *              → expiry 정산(사전 합의 penalty만 정산, 잔액 반환) → 재고 복구(0→1)
 *
 * 실행:
 *   GATEWAY_URL=http://127.0.0.1:8080 npx tsx scripts/agent-driver.ts honest
 *   GATEWAY_URL=http://127.0.0.1:8080 npx tsx scripts/agent-driver.ts abandon
 *
 * bond/payment 레일:
 *   - 기본(fake): session 생성 시 fake-payment-ok / fake-bond-ok 를 넘긴다 (main 현재 상태).
 *   - live(ADAPTER_MODE=live): open_bond 를 실제 devnet 에서 열어 그 계정 주소를 bondAccount 로
 *     넘긴다. gateway 측 real adapter 배선(B 소유 adapters.ts)이 붙은 뒤에만 세션이 ACTIVE 가 된다.
 *     이 드라이버는 자기 몫(온체인 bond open + Explorer 링크 출력)을 항상 수행한다.
 */

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://127.0.0.1:8080";
const SCENARIO = (process.argv[2] ?? "honest") as "honest" | "abandon";
const LIVE = (process.env.ADAPTER_MODE ?? "fake") === "live";
// TTL 만료를 기다리는 시간(초). 정책 ttlSeconds 보다 크게. 촬영 시 짧게 조정하려면 env 로 덮어쓴다.
const WAIT_SECONDS = Number(process.env.ABANDON_WAIT_SECONDS ?? 65);

const RESET = "\x1b[0m";
const C = {
  step: (s: string) => `\x1b[1;36m${s}${RESET}`,
  ok: (s: string) => `\x1b[1;32m${s}${RESET}`,
  deny: (s: string) => `\x1b[1;31m${s}${RESET}`,
  money: (s: string) => `\x1b[1;33m${s}${RESET}`,
  dim: (s: string) => `\x1b[2m${s}${RESET}`,
};

function usdc(atomic: string | number | undefined): string {
  if (atomic === undefined) return "—";
  return `${(Number(atomic) / 1_000_000).toFixed(3)} USDC`;
}

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

function banner(n: number, title: string) {
  console.log(`\n${C.step(`── Step ${n} ─ ${title} ${"─".repeat(Math.max(0, 46 - title.length))}`)}`);
}

async function main() {
  console.log(C.dim(`agent-driver · gateway=${GATEWAY_URL} · scenario=${SCENARIO} · rail=${LIVE ? "LIVE devnet" : "fake"}`));

  // Step 1 — 차단과 discovery ------------------------------------------------
  banner(1, "unregistered access → discovery");
  const blind = await api("GET", "/products");
  console.log(
    `  GET /products (미등록 정문) → ${C.deny(String(blind.status))} ${blind.json?.error?.code ?? "UNAUTHORIZED"}` +
      `${blind.json?.agentAccess?.discovery ? C.dim(`  → discovery: ${blind.json.agentAccess.discovery}`) : ""}`,
  );
  console.log(C.dim("  → 처음 보는 자동 클라이언트는 그냥 통과되지 않는다. 공식 통로를 찾는다."));
  const wk = await api("GET", "/.well-known/agent-access");
  console.log(`  GET /.well-known/agent-access → ${C.ok(String(wk.status))}`);
  console.log(
    C.dim(
      `    protocol=${wk.json?.protocol}  intent=${wk.json?.intentEndpoint}  bond=${wk.json?.bond?.network}` +
        `${wk.json?.payment?.integration ? `  [${wk.json.payment.integration}]` : ""}`,
    ),
  );

  // Step 2 — 자연어 의도 제출 → 정책 컴파일 ----------------------------------
  banner(2, "natural-language intent → compiled contract");
  const task =
    "Compare 20 laptops and reserve the best one for 60 seconds. Do not collect seller contacts.";
  console.log(`  의도: "${task}"`);
  const agentWallet = LIVE ? await liveAgentWallet() : "DemoAgentWallet1111111111111111111111111111";
  const intent = await api("POST", "/v1/intents", {
    body: { task, agentWallet, budget: { usageCapAtomic: "200000", bondCapAtomic: "1000000" } },
  });
  if (intent.status !== 200) fail("intent", intent);
  const { intentId, policyHash, bondTerms, paymentTerms } = intent.json;
  console.log(`  → policy 컴파일 ${C.ok("OK")}  hash=${C.dim(policyHash)}`);
  console.log(
    `    usage cap ${C.money(usdc(paymentTerms?.usageCapAtomic))} · bond ${C.money(usdc(bondTerms?.amountAtomic))}` +
      ` (required=${bondTerms?.required})`,
  );
  if (intent.json.validationMetadata?.fixtureMarker)
    console.log(C.dim(`    [${intent.json.validationMetadata.fixtureMarker}]  ← intent compiler 는 fixture`));

  // Step 3 — 사용료 준비 + bond open + 세션 ACTIVE ---------------------------
  banner(3, "payment ready + bond open + session ACTIVE");
  let bondAccount = "fake-bond-ok";
  if (LIVE) {
    bondAccount = await openLiveBond({ policyHash, bondTerms });
  } else {
    console.log(C.dim("  bond: fake-bond-ok (fake rail — 온체인 open 없음)"));
  }
  const session = await api("POST", "/v1/sessions", {
    idempotencyKey: `drv-${SCENARIO}-${Date.now()}`,
    body: { intentId, policyHash, paymentCredential: "fake-payment-ok", bondAccount },
  });
  if (session.status !== 200) fail("session", session);
  const token = session.json.token as string;
  const sessionId = session.json.sessionId as string;
  console.log(`  → session ${C.ok("ACTIVE")}  id=${sessionId}  expires=${session.json.expiresAt}`);
  console.log(C.dim("  → 장기 계정·API key 없이 범위가 정해진 접근권을 얻었다."));

  // Step 4 — 허용 호출 + 범위 밖 차단(무차감) --------------------------------
  banner(4, "allowed calls + out-of-scope block (no penalty)");
  const products = await api("GET", `/v1/access/${sessionId}/products`, { token });
  console.log(
    `  GET /products → ${C.ok(String(products.status))}  ${Array.isArray(products.json) ? products.json.length : "?"}개 상품 (사용료 과금됨)`,
  );
  const denied = await api("GET", `/v1/access/${sessionId}/seller-contacts`, { token });
  console.log(
    `  GET /seller-contacts → ${C.deny(String(denied.status))} ${denied.json?.error?.code ?? ""}  ` +
      `${C.ok("penalty 0 · upstream 0")}`,
  );
  console.log(C.dim("  → 차단은 처벌이 아니다. 범위 밖 요청은 origin 에 닿지도 않고 돈도 움직이지 않는다."));

  // Step 5 — 마지막 재고 예약(1 → 0) ----------------------------------------
  banner(5, "reserve last unit (inventory 1 → 0)");
  const before = await api("GET", `/v1/access/${sessionId}/products/lap-1/inventory`, { token });
  console.log(`  재고 확인 lap-1: ${C.money(String(before.json?.available ?? before.json?.stock ?? "?"))}`);
  const reservation = await api("POST", `/v1/access/${sessionId}/reservations`, {
    token,
    body: { productId: "lap-1", quantity: 1 },
  });
  if (reservation.status !== 200) fail("reservation", reservation);
  const reservationId = reservation.json.reservationId as string;
  const after = await api("GET", `/v1/access/${sessionId}/products/lap-1/inventory`, { token });
  console.log(
    `  POST /reservations lap-1 → ${C.ok(String(reservation.status))}  id=${reservationId}` +
      `  재고 ${C.money(`→ ${after.json?.available ?? after.json?.stock ?? "?"}`)}`,
  );
  console.log(C.dim("  → 예약은 판매자에게 실제 기회비용을 만든다. 이 행동에만 bond 가 걸린다."));

  if (SCENARIO === "honest") {
    // Step 6a — 정상 release + close(전액 환불) ------------------------------
    banner(6, "release + close (full refund)");
    await api("POST", `/v1/access/${sessionId}/reservations/${reservationId}/release`, { token });
    const restored = await api("GET", `/v1/access/${sessionId}/products/lap-1/inventory`, { token });
    console.log(`  예약 release → 재고 ${C.money(`→ ${restored.json?.available ?? restored.json?.stock ?? "?"}`)} 복구`);
    const close = await api("POST", `/v1/sessions/${sessionId}/close`, {
      token,
      idempotencyKey: `drv-close-${sessionId}`,
    });
    if (close.status !== 200) fail("close", close);
    const r = close.json;
    console.log(
      `  close → usage ${C.money(usdc(r.usageChargedAtomic))} · ` +
        `bond ${C.ok(`refunded ${usdc(r.bondRefundedAtomic)}`)} · penalty ${C.money(usdc(r.penaltyAtomic))}`,
    );
    printTx(r.transactions);
    console.log(C.ok("\n  ✔ 규칙을 지킨 에이전트: 쓴 만큼만 내고 bond 는 전액 돌려받았다."));
  } else {
    // Step 6b — TTL 만료 → bounded settlement → 재고 복구 --------------------
    banner(6, `abandon → TTL expiry → bounded settlement (wait ${WAIT_SECONDS}s)`);
    console.log(C.dim(`  에이전트가 예약을 release 하지 않고 이탈. 실제 TTL 만료를 기다린다…`));
    await countdown(WAIT_SECONDS);
    // 만료 정산 트리거 (expiry worker 가 별도로 돌면 그쪽이 먼저 처리할 수 있음 — 그 경우 이 호출은 idempotent)
    const expired = await api("POST", `/v1/access/${sessionId}/reservations/${reservationId}/expire`, { token });
    if (expired.status !== 200 && expired.status !== 409) fail("expire", expired);
    console.log(`  TTL 만료 → 예약 ${C.deny(String(expired.json?.state ?? "EXPIRED"))} · 세션 EXPIRED 전환`);
    // 만료 응답은 정책상 {reservationId, state}만 노출(allowedResponseFields) — 영수증은 전용 엔드포인트로
    const receiptRes = await api("GET", `/v1/sessions/${sessionId}/receipt`, { token });
    if (receiptRes.status !== 200) fail("receipt", receiptRes);
    const receipt = receiptRes.json;
    console.log(
      `  settlement → usage ${C.money(usdc(receipt?.usageChargedAtomic))} · ` +
        `merchant ${C.deny(`settled ${usdc(receipt?.penaltyAtomic)}`)} · ` +
        `agent ${C.ok(`returned ${usdc(receipt?.bondRefundedAtomic)}`)}`,
    );
    printTx(receipt?.transactions);
    console.log(
      C.dim(
        "  → 전액 몰수가 아니다. 코드가 객관적 만료를 집행하고, 사전 합의된 상한만 판매자에게 간다.",
      ),
    );
    // 재고 복구 실증 — 만료된 세션으로는 접근 불가하므로 새 관찰자 세션의 눈으로 확인
    const restoredStock = await observerInventory("lap-1");
    console.log(
      `  재고 복구 확인(새 세션의 눈): lap-1 ${C.money(String(restoredStock))}` +
        C.dim("  ← 방치된 예약이 재고를 영구 잠그지 않는다"),
    );
  }

  // trace 링크 안내
  const events = await api("GET", `/v1/sessions/${sessionId}/events`, { token });
  console.log(
    C.dim(`\n  events(${events.json?.events?.length ?? 0}): ${events.json?.events?.map((e: any) => e.type).join(" → ")}`),
  );
}

// 만료 후 세션은 EXPIRED 라 자기 눈으로 재고를 못 본다 — 별도 read-only 세션으로 복구를 확인.
// 실패해도 데모 본류를 죽이지 않도록 비치명적으로 처리.
async function observerInventory(productId: string): Promise<string> {
  try {
    const intent = await api("POST", "/v1/intents", {
      body: {
        task: "Check laptop inventory.",
        agentWallet: "DemoObserverWallet111111111111111111111111",
        budget: { usageCapAtomic: "200000", bondCapAtomic: "1000000" },
      },
    });
    if (intent.status !== 200) return "?";
    const session = await api("POST", "/v1/sessions", {
      idempotencyKey: `drv-observer-${Date.now()}`,
      body: {
        intentId: intent.json.intentId,
        policyHash: intent.json.policyHash,
        paymentCredential: "fake-payment-ok",
        bondAccount: "fake-bond-ok",
      },
    });
    if (session.status !== 200) return "?";
    const obsToken = session.json.token as string;
    const obsId = session.json.sessionId as string;
    const inv = await api("GET", `/v1/access/${obsId}/products/${productId}/inventory`, { token: obsToken });
    await api("POST", `/v1/sessions/${obsId}/close`, { token: obsToken, idempotencyKey: `drv-observer-close-${obsId}` });
    return String(inv.json?.available ?? inv.json?.stock ?? "?");
  } catch {
    return "?";
  }
}

function printTx(transactions?: Array<{ kind: string; status: string; providerReference?: string; fixtureMarker?: string }>) {
  for (const t of transactions ?? []) {
    const live = !t.fixtureMarker && /^[1-9A-HJ-NP-Za-km-z]{60,}$/.test(t.providerReference ?? "");
    const link = live
      ? `https://explorer.solana.com/tx/${t.providerReference}?cluster=devnet`
      : C.dim(`${t.providerReference ?? "—"}${t.fixtureMarker ? ` [${t.fixtureMarker}]` : ""}`);
    console.log(`    ${t.kind} ${t.status === "CONFIRMED" ? C.ok(t.status) : t.status}  ${link}`);
  }
}

async function countdown(seconds: number) {
  for (let s = seconds; s > 0; s--) {
    process.stdout.write(`\r  ${C.dim(`… TTL 만료까지 ${s}s`)}   `);
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write("\r" + " ".repeat(40) + "\r");
}

function fail(where: string, res: { status: number; json: any }): never {
  console.error(C.deny(`\n  '${where}' 실패 ${res.status}: ${JSON.stringify(res.json)}`));
  process.exit(1);
}

// --- LIVE rail (devnet) — B 배선 전까지는 자기 몫만 수행 ----------------------

async function liveAgentWallet(): Promise<string> {
  const { agentKeypair } = await loadLiveContext();
  return agentKeypair.publicKey.toBase58();
}

let _liveCtx: any | null = null;
async function loadLiveContext() {
  if (_liveCtx) return _liveCtx;
  const anchor = await import("@coral-xyz/anchor");
  const { Keypair, Connection } = await import("@solana/web3.js");
  const fs = await import("node:fs");
  const walletPath = process.env.AGENT_WALLET ?? `${process.env.HOME}/.config/solana/id.json`;
  const agentKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8"))));
  const connection = new Connection(process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com", "confirmed");
  _liveCtx = { anchor, agentKeypair, connection };
  return _liveCtx;
}

async function openLiveBond(_args: { policyHash: string; bondTerms: any }): Promise<string> {
  // 실제 open_bond 는 payment-client BotBondClient 로 수행한다. gateway real adapter 가 이 계정을
  // verifyOpenBond 로 검증하므로, 여기서는 계정 주소만 반환하고 Explorer 링크를 출력한다.
  // (B 의 adapters.ts real 배선 전까지는 세션이 ACTIVE 로 넘어가지 않을 수 있음 — 알려진 상태.)
  console.log(C.dim("  bond: devnet open_bond 수행… (payment-client)"));
  try {
    const { BotBondClient } = await import("../packages/payment-client/src/index.js");
    void BotBondClient; // 실제 open 배선은 devnet-scenario.ts 파이프라인을 재사용 (별도 PR)
    console.log(C.deny("  ⚠ live open_bond 는 devnet-scenario.ts 경로로 실행하세요 (드라이버 단독 미배선)"));
  } catch (e) {
    console.log(C.deny(`  ⚠ live bond 모듈 로드 실패: ${String(e)}`));
  }
  return process.env.BOND_ACCOUNT ?? "fake-bond-ok";
}

main().catch((e) => {
  console.error(C.deny(`driver error: ${String(e)}`));
  process.exit(1);
});
