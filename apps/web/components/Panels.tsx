"use client";

import type { ViewState } from "@/lib/types";
import { clockFrom, explorerUrl, shortHash, shortSig, usdc } from "@/lib/format";

/* ------------------------------------------------------------------ shell */

export function Panel({
  step,
  title,
  children,
}: {
  step: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-head">
        <span className="panel-step">{step}</span>
        <h2 className="panel-title">{title}</h2>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

/* ----------------------------------------------------------------- intent */

export function IntentPanel({ v }: { v: ViewState }) {
  if (!v.task) {
    return (
      <p className="muted-empty">
        No agent has introduced itself yet.
        <br />
        <br />
        Press Play to watch one arrive with no account, no API key, and no
        prior relationship.
      </p>
    );
  }
  return (
    <>
      <p className="intent-quote">{v.task}</p>
      {v.taskEn && <p className="intent-en">{v.taskEn}</p>}
      <dl>
        <div className="kv">
          <dt>session</dt>
          <dd>
            <span className="state-chip" data-state={v.sessionState}>
              {v.sessionState}
            </span>
          </dd>
        </div>
        <div className="kv">
          <dt>usage cap</dt>
          <dd>{usdc(v.usageCapAtomic)} USDC</dd>
        </div>
        <div className="kv">
          <dt>bond offered</dt>
          <dd>{usdc(v.bondAmountAtomic)} USDC</dd>
        </div>
        <div className="kv">
          <dt>calls used</dt>
          <dd>
            {v.callCount}
            {v.policy ? ` / ${v.policy.constraints.maxTotalCalls}` : ""}
          </dd>
        </div>
        {v.deniedCount > 0 && (
          <div className="kv">
            <dt>denied</dt>
            <dd>{v.deniedCount}</dd>
          </div>
        )}
      </dl>
    </>
  );
}

/* --------------------------------------------------------------- manifest */

export function ManifestPanel({ v }: { v: ViewState }) {
  if (!v.policy) {
    return (
      <p className="muted-empty">
        Waiting for the compiler.
        <br />
        <br />
        Gemini turns the sentence on the left into a signed, least-privilege
        contract. Nothing outside it will ever reach the protected API.
      </p>
    );
  }

  // A bonded action is whatever the signed policy says is bonded — nothing is
  // inferred from the path here.
  const hasReservationBond = v.policy.bondedActions.some(
    (b) => b.operationId === "reserve-inventory",
  );

  return (
    <>
      <article className="manifest">
        <div className="manifest-top">
          <div>
            <span className="manifest-label">Signed access contract</span>
            <p className="manifest-purpose">{v.policy.purpose}</p>
          </div>
          <div className="seal">
            <span className="seal-label">POLICY HASH</span>
            <span className="seal-hash">{shortHash(v.policyHash)}</span>
          </div>
        </div>

        {v.policy.allowedOperations.map((op) => {
          const isBonded = hasReservationBond && op.pathTemplate === "/reservations";
          return (
            <div
              className={`op-row${isBonded ? " bonded" : ""}`}
              key={`${op.method}-${op.pathTemplate}`}
            >
              <span className="m">{op.method}</span>
              <span className="p">
                {op.pathTemplate}
                <span className="fields">{op.allowedResponseFields.join(" · ")}</span>
              </span>
              <span className="cap">≤ {op.maxCalls}</span>
            </div>
          );
        })}

        {v.excluded.map((x) => (
          <div className="op-row excluded" key={x.path}>
            <span className="m">—</span>
            <span className="p">
              {x.path}
              <span className="fields">{x.reason}</span>
            </span>
            <span className="cap">excluded</span>
          </div>
        ))}

        {v.explanation.length > 0 && (
          <div className="manifest-note">
            <ul>
              {v.explanation.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </article>

      {v.compilerMeta && (
        <p className="compiler-meta">
          {v.compilerMeta.model} · {v.compilerMeta.latencyMs}ms ·{" "}
          {v.compilerMeta.repairAttempts} repair
          {v.compilerMeta.repairAttempts === 1 ? "" : "s"} · schema-validated
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ money */

export function MoneyPanel({ v }: { v: ViewState }) {
  const usagePct = v.usageCapAtomic
    ? Math.min(100, (v.usageSpentAtomic / v.usageCapAtomic) * 100)
    : 0;

  const penaltyPct = v.bondAmountAtomic
    ? Math.min(100, (v.penaltyAtomic / v.bondAmountAtomic) * 100)
    : 0;

  return (
    <>
      {/* usage — spent and gone */}
      <div className="money-block">
        <div className="money-head">
          <span className="money-name usage">USAGE · pay.sh</span>
          <span className="money-sub">spent, not returned</span>
        </div>
        <div className="money-amount usage">
          {usdc(v.usageSpentAtomic)}
          <span className="unit">/ {usdc(v.usageCapAtomic)} USDC</span>
        </div>
        <div className="drain">
          <div className="drain-fill" style={{ width: `${usagePct}%` }} />
        </div>
        {v.usageSettled && (
          <p className="ceiling-note">Settled for {v.callCount} allowed calls. Denied requests were never charged.</p>
        )}
      </div>

      {/* bond — locked, then returned */}
      <div className="money-block">
        <div className="money-head">
          <span className="money-name bond">BOND · Solana</span>
          <span className="money-sub">
            {v.bondPhase === "RETURNED" ? "returned" : "locked, refundable"}
          </span>
        </div>
        <div className="money-amount bond">
          {v.bondPhase === "RETURNED"
            ? usdc(v.bondRefundedAtomic)
            : usdc(v.bondAmountAtomic)}
          <span className="unit">
            {v.bondPhase === "RETURNED" ? "USDC returned" : "USDC held"}
          </span>
        </div>

        {v.bondPhase === "NONE" ? (
          <p className="ceiling-note">No bond yet. A bond is only required for actions that cost the merchant something.</p>
        ) : (
          <>
            <div className="vault">
              {v.penaltyAtomic > 0 && (
                <div
                  className="vault-seg settled"
                  style={{ flex: `0 0 ${penaltyPct}%` }}
                >
                  <span className="seg-label">−{usdc(v.penaltyAtomic)}</span>
                </div>
              )}
              <div
                className={`vault-seg ${v.bondPhase === "RETURNED" ? "returned" : "held"}`}
              >
                <span className="seg-label">
                  {v.bondPhase === "RETURNED" ? "RETURNED" : "HELD"}
                </span>
              </div>
            </div>
            <div className="vault-legend">
              <span>
                ceiling {usdc(v.maxPenaltyAtomic)} · taken {usdc(v.penaltyAtomic)}
              </span>
              <span>{v.bondPhase}</span>
            </div>
          </>
        )}

        {v.lastBondDeltaWasZeroOnDenial && (
          <p className="bond-steady">
            Request denied. The bond did not move.
            <br />
            Blocking is not slashing.
          </p>
        )}

        {v.penaltyAtomic > 0 && (
          <p className="ceiling-note">
            Settled only because a reservation objectively expired, and only up
            to the signed ceiling. The program rejects anything above it.
          </p>
        )}
      </div>

      {/* reservation */}
      {v.reservation && (
        <div className="rsv">
          <div className="rsv-top">
            <span className="rsv-id">
              {v.reservation.id} · {v.reservation.productId}
            </span>
            <span className="rsv-status" data-s={v.reservation.status}>
              {v.reservation.status}
            </span>
          </div>
          <div className="ttl-track">
            <div
              className={`ttl-fill${v.reservation.status === "EXPIRED" ? " expired" : ""}`}
              style={{
                width:
                  v.reservation.status === "HELD" && v.reservation.secondsRemaining !== null
                    ? `${(v.reservation.secondsRemaining / v.reservation.ttlSeconds) * 100}%`
                    : v.reservation.status === "EXPIRED"
                      ? "100%"
                      : "0%",
              }}
            />
          </div>
        </div>
      )}

      {/* transactions */}
      {v.txs.length > 0 && (
        <ul className="tx-list">
          {v.txs.map((tx) => (
            <li className="tx-item" key={tx.signature + tx.label}>
              <span className="tx-label">{tx.label}</span>
              {tx.explorerEligible ? (
                <a
                  className="tx-sig"
                  href={explorerUrl(tx.signature, tx.cluster)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortSig(tx.signature)}
                </a>
              ) : (
                <span className="tx-sig" title="Development fixture reference — no Explorer link">
                  {shortSig(tx.signature)}
                </span>
              )}
              <span className="tx-status" data-s={tx.status}>
                {tx.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ trace */

export function TracePanel({ v }: { v: ViewState }) {
  return (
    <section className="panel trace-panel">
      <header className="panel-head">
        <span className="panel-step">04</span>
        <h2 className="panel-title">Decision trace</h2>
        <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-dim)" }}>
          every verdict, with its reason
        </span>
      </header>
      <div className="trace-scroll">
        {v.trace.length === 0 && (
          <p className="muted-empty" style={{ padding: "15px 16px" }}>
            No requests yet.
          </p>
        )}
        {v.trace.map((r) => (
          <div className="trace-row" data-kind={r.kind} key={r.id}>
            <span className="trace-time">{clockFrom(r.at)}</span>
            <span className="trace-verdict">{r.headline.toUpperCase()}</span>
            <span className="trace-path">
              {r.method && <span style={{ color: "var(--ink-dim)" }}>{r.method} </span>}
              {r.path}
              {r.detail && <span className="trace-detail">{r.detail}</span>}
            </span>
            <span className="trace-bond">
              {r.bondUnchanged ? "bond ±0" : "bond changed"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- receipt */

export function Receipt({ v }: { v: ViewState }) {
  if (!v.outcome) return null;
  return (
    <div className="receipt">
      <div className="receipt-cell">
        <span className="k">OUTCOME</span>
        <span className={`v ${v.outcome === "VIOLATED" ? "seal" : "bond"}`}>{v.outcome}</span>
      </div>
      <div className="receipt-cell">
        <span className="k">USAGE CHARGED</span>
        <span className="v usage">{usdc(v.usageSpentAtomic)}</span>
      </div>
      <div className="receipt-cell">
        <span className="k">PENALTY</span>
        <span className={`v ${v.penaltyAtomic > 0 ? "seal" : ""}`}>{usdc(v.penaltyAtomic)}</span>
      </div>
      <div className="receipt-cell">
        <span className="k">BOND RETURNED</span>
        <span className="v bond">{usdc(v.bondRefundedAtomic)}</span>
      </div>
      <div className="receipt-cell">
        <span className="k">RECEIPT HASH</span>
        <span className="v" style={{ fontSize: 11 }}>{shortHash(v.receiptHash)}</span>
      </div>
    </div>
  );
}
