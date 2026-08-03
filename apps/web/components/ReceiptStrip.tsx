"use client";

import type { ViewState } from "@/lib/types";
import { clockFrom, explorerUrl, shortHash, shortSig, usdc } from "@/lib/format";

/**
 * The whole session prints as one continuous roll. Order matters: what was
 * asked, what was agreed, what happened, what it cost. A receipt is read top to
 * bottom, so nothing needs a card around it.
 *
 * Usage and bond stay distinguishable without colour: spent money is marked
 * with a highlighter and stays marked; the bond is drawn as a box that is
 * either whole or has a slice cut out of it.
 */

export function ReceiptStrip({ v }: { v: ViewState }) {
  const started = v.task !== null;

  return (
    <article className="strip">
      <header className="strip-head">
        <h2 className="strip-title">BOTBOND</h2>
        <p className="strip-sub">BONDED ACCESS RECEIPT</p>
      </header>

      {!started && (
        <>
          <hr className="perf" />
          <p className="strip-empty">
            발급 대기 중.
            <br />
            <br />
            이 자리에 인쇄될 세션은
            <br />
            아직 시작되지 않았습니다.
          </p>
          <hr className="perf" />
        </>
      )}

      {started && (
        <>
          <hr className="perf" />
          <section className="sec">
            <p className="sec-k">DECLARED INTENT</p>
            <p className="intent-ko">{v.task}</p>
            {v.taskEn && <p className="intent-en">{v.taskEn}</p>}
          </section>

          <hr className="perf" />
          <section className="sec">
            <p className="sec-k">SIGNED SCOPE</p>
            {!v.policy && (
              <p className="compiler-meta">컴파일 대기 중…</p>
            )}
            {v.policy?.allowedOperations.map((op) => {
              const bonded =
                op.pathTemplate === "/reservations" &&
                v.policy!.bondedActions.length > 0;
              return (
                <div
                  className={`scope-line${bonded ? " bonded" : ""}`}
                  key={`${op.method}-${op.pathTemplate}`}
                >
                  <span className="m">{op.method}</span>
                  <span className="p">
                    {op.pathTemplate}
                    <span className="fields">
                      {op.allowedResponseFields.join(" · ")}
                    </span>
                  </span>
                  <span className="cap">≤ {op.maxCalls}</span>
                </div>
              );
            })}
            {v.excluded.map((x) => (
              <div className="scope-line out" key={x.path}>
                <span className="m">—</span>
                <span className="p">
                  {x.path}
                  <span className="fields">{x.reason}</span>
                </span>
                <span className="cap">CUT</span>
              </div>
            ))}
            {v.explanation.length > 0 && (
              <ul className="note-list">
                {v.explanation.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {v.compilerMeta && (
              <p className="compiler-meta">
                {v.compilerMeta.model} · {v.compilerMeta.latencyMs}ms ·{" "}
                {v.compilerMeta.repairAttempts} repair · schema-validated ·{" "}
                {shortHash(v.policyHash)}
              </p>
            )}
          </section>

          <hr className="perf" />
          <section className="sec">
            <p className="sec-k">
              LOG · {v.callCount} allowed
              {v.deniedCount > 0 ? ` · ${v.deniedCount} denied` : ""}
            </p>
            {v.trace.length === 0 && <p className="compiler-meta">요청 없음</p>}
            {v.trace.slice(-9).map((r) => (
              <div className="roll-line" data-kind={r.kind} key={r.id}>
                <span className="tm">{clockFrom(r.at)}</span>
                <span className="vd">{r.headline.toUpperCase()}</span>
                <span className="pt">
                  {r.method ? `${r.method} ` : ""}
                  {r.path}
                  {r.detail && <span className="why">{r.detail}</span>}
                </span>
              </div>
            ))}
          </section>

          {v.reservation && (
            <>
              <hr className="perf" />
              <section className="sec">
                <p className="sec-k">BONDED ACTION</p>
                <div className="rsv-line">
                  <span>
                    {v.reservation.id} · {v.reservation.productId}
                  </span>
                  <span className="rsv-state" data-s={v.reservation.status}>
                    {v.reservation.status}
                  </span>
                </div>
                <div className="ttl">
                  <span
                    className={v.reservation.status === "EXPIRED" ? "expired" : ""}
                    style={{
                      width:
                        v.reservation.status === "HELD" &&
                        v.reservation.secondsRemaining !== null
                          ? `${(v.reservation.secondsRemaining / v.reservation.ttlSeconds) * 100}%`
                          : v.reservation.status === "EXPIRED"
                            ? "100%"
                            : "0%",
                    }}
                  />
                </div>
              </section>
            </>
          )}

          <hr className="perf" />
          <section className="sec">
            <p className="sec-k">CHARGES</p>

            <div className="amount-row">
              <span className="amount-k">USAGE · pay.sh</span>
              <span className="marked">{usdc(v.usageSpentAtomic)}</span>
            </div>
            <p className="amount-note">
              {v.usageSettled
                ? `${v.callCount}건 정산 · 차단된 요청은 과금되지 않음`
                : `상한 ${usdc(v.usageCapAtomic)} · 쓴 만큼 사라짐`}
            </p>

            <div className="amount-row" style={{ marginTop: 14 }}>
              <span className="amount-k">BOND · Solana</span>
              <span className={`plain${v.penaltyAtomic > 0 ? " struck" : ""}`}>
                {v.bondPhase === "RETURNED"
                  ? usdc(v.bondRefundedAtomic)
                  : usdc(v.bondAmountAtomic)}
              </span>
            </div>

            {v.bondPhase === "NONE" ? (
              <p className="amount-note">
                아직 보증금 없음 · 판매자에게 비용을 발생시키는 행동에만 필요
              </p>
            ) : (
              <>
                <div className="bond-box">
                  {v.penaltyAtomic > 0 && (
                    <span
                      className="bond-taken"
                      style={{
                        width: `${(v.penaltyAtomic / v.bondAmountAtomic) * 100}%`,
                      }}
                    />
                  )}
                  <span
                    className={`bond-kept${v.bondPhase === "RETURNED" ? " returned" : ""}`}
                  >
                    {v.bondPhase === "RETURNED" ? "RETURNED" : "HELD"}
                  </span>
                </div>
                <p className="ceiling">
                  <span>상한 {usdc(v.maxPenaltyAtomic)}</span>
                  <span>차감 {usdc(v.penaltyAtomic)}</span>
                </p>
              </>
            )}

            {v.lastBondDeltaWasZeroOnDenial && (
              <p className="steady">
                요청이 차단되었습니다. 보증금은 움직이지 않았습니다.
                <br />
                차단은 차감이 아닙니다.
              </p>
            )}

            {v.penaltyAtomic > 0 && (
              <p className="amount-note" style={{ marginTop: 8 }}>
                예약이 객관적으로 만료되었을 때만, 서명된 상한 안에서 정산됩니다.
              </p>
            )}
          </section>

          {v.outcome && (
            <>
              <hr className="perf perf-solid" />
              <section className="total">
                <div className="total-row">
                  <span>USAGE CHARGED</span>
                  <span className="v marked">{usdc(v.usageSpentAtomic)}</span>
                </div>
                <div className="total-row">
                  <span>PENALTY</span>
                  <span className={`v${v.penaltyAtomic > 0 ? " plain struck" : ""}`}>
                    {usdc(v.penaltyAtomic)}
                  </span>
                </div>
                <div className="total-row">
                  <span>BOND RETURNED</span>
                  <span className="v">{usdc(v.bondRefundedAtomic)}</span>
                </div>
                <div className="total-row grand">
                  <span>NET COST</span>
                  <span className="v">
                    {usdc(v.usageSpentAtomic + v.penaltyAtomic)}
                  </span>
                </div>
              </section>

              <div className="stamp" data-outcome={v.outcome}>
                {v.outcome}
                <span className="stamp-hash">{shortHash(v.receiptHash)}</span>
              </div>
            </>
          )}
        </>
      )}

      <p className="strip-foot">— END OF ROLL —</p>
    </article>
  );
}

export function ChainRail({ v }: { v: ViewState }) {
  if (v.txs.length === 0) {
    return <p className="rail-note">아직 체인 활동 없음.</p>;
  }
  return (
    <>
      {v.txs.map((tx) => (
        <div className="chain-row" key={tx.signature + tx.label}>
          <span className="k">{tx.label.toUpperCase()}</span>
          <a href={explorerUrl(tx.signature, tx.cluster)} target="_blank" rel="noreferrer">
            {shortSig(tx.signature)}
          </a>
          <span className="chain-status" data-s={tx.status}>
            {tx.status} · {tx.cluster}
          </span>
        </div>
      ))}
    </>
  );
}
