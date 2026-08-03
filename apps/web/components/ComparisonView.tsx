"use client";

import { useEffect, useMemo, useState } from "react";
import type { Fixture, ViewState } from "@/lib/types";
import { replay } from "@/lib/reducer";
import { usdc } from "@/lib/format";

/**
 * Side-by-side comparison. A single session cannot answer "is 0.02 cheap?" —
 * the number only means something next to the agent that broke the rules.
 * Both timelines advance on one shared clock so the moment they diverge is
 * visible rather than remembered.
 */

type Lane = {
  key: string;
  file: string;
  title: string;
  subtitle: string;
  fixture: Fixture | null;
};

const LANES: Omit<Lane, "fixture">[] = [
  {
    key: "honest",
    file: "01-normal-session",
    title: "규칙을 지킨 에이전트",
    subtitle: "Declared, used, released",
  },
  {
    key: "abandoner",
    file: "03-abandoned-reservation",
    title: "예약을 방치한 에이전트",
    subtitle: "Declared, used, walked away",
  },
];

function netCost(v: ViewState): number {
  return v.usageSpentAtomic + v.penaltyAtomic;
}

function Meter({ v, accent }: { v: ViewState; accent: "ok" | "bad" }) {
  const bondPct = v.bondAmountAtomic
    ? (v.penaltyAtomic / v.bondAmountAtomic) * 100
    : 0;
  return (
    <div className="cmp-meters">
      <div className="cmp-row">
        <span className="cmp-k">usage</span>
        <span className="cmp-v usage">{usdc(v.usageSpentAtomic)}</span>
      </div>
      <div className="cmp-row">
        <span className="cmp-k">penalty</span>
        <span className={`cmp-v ${v.penaltyAtomic > 0 ? "seal" : "zero"}`}>
          {usdc(v.penaltyAtomic)}
        </span>
      </div>
      <div className="cmp-row">
        <span className="cmp-k">bond back</span>
        <span className="cmp-v bond">
          {v.bondPhase === "NONE" ? "—" : usdc(v.bondRefundedAtomic || v.bondAmountAtomic)}
        </span>
      </div>

      <div className="cmp-bond-bar" aria-hidden>
        {v.penaltyAtomic > 0 && (
          <span className="cmp-bond-taken" style={{ width: `${bondPct}%` }} />
        )}
        <span className="cmp-bond-kept" />
      </div>

      <div className={`cmp-net ${accent}`}>
        <span className="cmp-net-k">순비용</span>
        <span className="cmp-net-v">{usdc(netCost(v))}</span>
        <span className="cmp-net-u">USDC</span>
      </div>
    </div>
  );
}

function Timeline({ v }: { v: ViewState }) {
  const rows = v.trace.slice(-5);
  return (
    <ul className="cmp-trace">
      {rows.map((r) => (
        <li key={r.id} data-kind={r.kind}>
          <span className="cmp-verdict">{r.headline}</span>
          <span className="cmp-path">{r.path ?? r.detail}</span>
        </li>
      ))}
      {rows.length === 0 && <li className="cmp-idle">대기 중</li>}
    </ul>
  );
}

export function ComparisonView() {
  const [lanes, setLanes] = useState<Lane[]>(
    LANES.map((l) => ({ ...l, fixture: null })),
  );
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      LANES.map((l) =>
        fetch(`/fixtures/${l.file}.json`)
          .then((r) => r.json())
          .catch(() => null),
      ),
    ).then((fixtures) => {
      if (cancelled) return;
      setLanes(LANES.map((l, i) => ({ ...l, fixture: fixtures[i] })));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const maxSteps = useMemo(
    () => Math.max(...lanes.map((l) => l.fixture?.events.length ?? 0), 0),
    [lanes],
  );

  useEffect(() => {
    if (!running || maxSteps === 0) return;
    if (step >= maxSteps) {
      setRunning(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 130);
    return () => clearTimeout(t);
  }, [running, step, maxSteps]);

  const views = lanes.map((l) =>
    l.fixture ? replay(l.fixture.events, step) : replay([], 0),
  );

  const done = step >= maxSteps && maxSteps > 0;

  return (
    <section className="cmp">
      <header className="cmp-head">
        <div>
          <span className="cmp-eyebrow">SAME POLICY · SAME PRICES · SAME START</span>
          <h2 className="cmp-title">둘 다 통과했다. 비용만 갈렸다.</h2>
        </div>
        <button
          className="tbtn primary"
          onClick={() => {
            if (done) setStep(0);
            setRunning((r) => (done ? true : !r));
          }}
        >
          {running ? "일시정지" : done ? "다시 실행" : "동시 실행"}
        </button>
      </header>

      <div className="cmp-grid">
        {lanes.map((l, i) => (
          <article
            className="cmp-lane"
            data-accent={i === 0 ? "ok" : "bad"}
            key={l.key}
          >
            <h3 className="cmp-lane-title">{l.title}</h3>
            <p className="cmp-lane-sub">{l.subtitle}</p>
            <Meter v={views[i]} accent={i === 0 ? "ok" : "bad"} />
            <Timeline v={views[i]} />
          </article>
        ))}
      </div>

    </section>
  );
}
