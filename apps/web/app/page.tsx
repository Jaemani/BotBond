"use client";

import { useEffect, useState } from "react";
import type { Fixture } from "@/lib/types";
import type { LiveEventStream } from "@/lib/usePlayer";
import { usePlayer } from "@/lib/usePlayer";
import {
  IntentPanel,
  ManifestPanel,
  MoneyPanel,
  Panel,
  Receipt,
  TracePanel,
} from "@/components/Panels";

const SCENARIOS = [
  { id: "01-normal-session", label: "정상 세션", en: "Clean session" },
  { id: "02-scope-denied", label: "범위 밖 차단", en: "Blocked, not slashed" },
  { id: "03-abandoned-reservation", label: "예약 방치", en: "Bounded settlement" },
];

function liveStreamFromLocation(): LiveEventStream | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("sessionId");
  const token = params.get("token");
  if (!sessionId || !token) return null;
  const gateway = (params.get("gateway") ?? "/gateway").replace(/\/$/, "");
  return { url: `${gateway}/v1/sessions/${encodeURIComponent(sessionId)}/events`, token };
}

export default function Page() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [live, setLive] = useState<LiveEventStream | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => setLive(liveStreamFromLocation()), []);

  useEffect(() => {
    if (live) return;
    let cancelled = false;
    setLoadError(null);
    fetch(`/fixtures/${scenarioId}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Fixture ${scenarioId} returned ${r.status}`);
        return r.json();
      })
      .then((data: Fixture) => {
        if (!cancelled) setFixture(data);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setFixture(null);
          setLoadError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scenarioId, live]);

  const p = usePlayer(fixture, live);
  const v = p.view;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1 className="wordmark">
            Bot<span>Bond</span>
          </h1>
          <p className="tagline">
            처음 보는 에이전트도 목적을 선언하고 환불 가능한 보증금을 걸면
            제한된 API 세션을 받는다.
          </p>
        </div>
        <div>
          {live && <span className="fixture-badge">SSE {p.liveStatus}</span>}
          {v.fixtureMode && (
            <span className="fixture-badge">DEV FIXTURE — NOT LIVE CHAIN DATA</span>
          )}
        </div>
      </header>

      <nav className="scenarios" aria-label="Demo scenarios">
        {SCENARIOS.map((s, i) => (
          <button
            key={s.id}
            className="scenario-tab"
            aria-pressed={scenarioId === s.id}
            disabled={Boolean(live)}
            onClick={() => setScenarioId(s.id)}
          >
            <span className="idx">{String(i + 1).padStart(2, "0")}</span>
            <span className="lbl">{s.label}</span>
            <span className="idx">{s.en}</span>
          </button>
        ))}
      </nav>

      {loadError && (
        <p className="muted-empty" style={{ color: "var(--seal)", marginBottom: 14 }}>
          Could not load the fixture: {loadError}. Check that
          public/fixtures/{scenarioId}.json exists.
        </p>
      )}

      <div className="stage">
        <Panel step="01" title="Intent">
          <IntentPanel v={v} />
        </Panel>
        <Panel step="02" title="Contract">
          <ManifestPanel v={v} />
        </Panel>
        <Panel step="03" title="Money">
          <MoneyPanel v={v} />
        </Panel>
      </div>

      <TracePanel v={v} />
      <Receipt v={v} />

      <div className="transport" role="group" aria-label="Playback controls">
        <button className="tbtn primary" onClick={p.playing ? p.pause : p.play} disabled={Boolean(live)}>
          {p.playing ? "Pause" : p.cursor >= p.total && p.total > 0 ? "Replay" : "Play"}
        </button>
        <button className="tbtn" onClick={p.step} disabled={Boolean(live) || p.cursor >= p.total}>
          Step
        </button>
        <button className="tbtn" onClick={p.reset}>
          Reset
        </button>
        <button className="tbtn" onClick={p.jumpToEnd} disabled={Boolean(live)}>
          End
        </button>
        <span className="progress">
          {p.cursor} / {p.total}
        </span>
        <div className="speeds">
          {[1, 2, 4].map((sp) => (
            <button
              key={sp}
              className="speed-btn"
              aria-pressed={p.speed === sp}
              disabled={Boolean(live)}
              onClick={() => p.setSpeed(sp)}
            >
              {sp}×
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
