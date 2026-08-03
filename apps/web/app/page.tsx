"use client";

import { useState } from "react";
import { useMultiPlayer, type ScenarioSpec } from "@/lib/useMultiPlayer";
import { ComparisonView } from "@/components/ComparisonView";
import { ChainRail, ReceiptStrip } from "@/components/ReceiptStrip";

const SCENARIOS: (ScenarioSpec & { label: string; en: string })[] = [
  { id: "normal", file: "01-normal-session", label: "정상 세션", en: "CLEAN" },
  { id: "denied", file: "02-scope-denied", label: "범위 밖 차단", en: "BLOCKED, NOT SLASHED" },
  { id: "expired", file: "03-abandoned-reservation", label: "예약 방치", en: "BOUNDED SETTLEMENT" },
];

export default function Page() {
  const [activeId, setActiveId] = useState(SCENARIOS[0].id);
  const p = useMultiPlayer(SCENARIOS);

  const lane = p.lanes[activeId];
  if (!lane) return null;
  const v = lane.view;

  return (
    <main className="shell">
      <header className="brandbar">
        <div>
          <h1 className="wordmark">BOTBOND</h1>
          <p className="tagline">
            처음 보는 에이전트도 목적을 선언하고 환불 가능한 보증금을 걸면
            제한된 API 세션을 받는다.
          </p>
        </div>
        <span className="fixture-badge">DEV FIXTURE · NOT LIVE CHAIN DATA</span>
      </header>

      <aside className="rail rail-left">
        <div className="rail-block">
          <p className="rail-label">SCENARIOS</p>
          {SCENARIOS.map((s, i) => {
            const l = p.lanes[s.id];
            const status = !l
              ? ""
              : l.playing
                ? "running"
                : l.finished
                  ? "done"
                  : l.cursor > 0
                    ? "paused"
                    : "idle";
            return (
              <button
                key={s.id}
                className="scenario-tab"
                aria-pressed={activeId === s.id}
                data-status={status}
                onClick={() => setActiveId(s.id)}
              >
                <span className="idx">
                  {String(i + 1).padStart(2, "0")}
                  {l && l.total > 0 && (
                    <span className="tab-progress">
                      {l.cursor}/{l.total}
                    </span>
                  )}
                </span>
                <span className="lbl">{s.label}</span>
                <span className="idx">{s.en}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="strip-wrap">
        <ReceiptStrip v={v} />
      </div>

      <aside className="rail rail-right">
        <div className="rail-block">
          <p className="rail-label">CHAIN · DEVNET</p>
          <ChainRail v={v} />
        </div>
        <p className="rail-note">
          사용료는 pay.sh가, 담보는 Solana 프로그램이 담당합니다. 화면의 서명은
          fixture 값입니다.
        </p>
      </aside>

      <ComparisonView />

      <div className="transport" role="group" aria-label="Playback controls">
        <button className="tbtn primary" onClick={() => p.toggle(activeId)}>
          {lane.playing ? "정지" : lane.finished ? "다시" : "실행"}
        </button>
        <button className="tbtn" onClick={() => p.step(activeId)} disabled={lane.finished}>
          한 칸
        </button>
        <button className="tbtn" onClick={() => p.reset(activeId)}>
          되감기
        </button>
        <button className="tbtn" onClick={() => p.jumpToEnd(activeId)}>
          끝으로
        </button>
        <span className="progress">
          {lane.cursor} / {lane.total}
        </span>
        <span className="transport-sep" />
        <button className="tbtn" onClick={p.playAll}>
          전체 실행
        </button>
        <button className="tbtn" onClick={p.resetAll}>
          전체 초기화
        </button>
        <div className="speeds">
          {[1, 2, 4].map((sp) => (
            <button
              key={sp}
              className="speed-btn"
              aria-pressed={p.speed === sp}
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
