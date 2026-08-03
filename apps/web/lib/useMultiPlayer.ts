"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BotBondEvent, Fixture, ViewState } from "./types";
import { replay } from "./reducer";

const TICK_MS = 60;
const MIN_GAP_MS = 90;
const MAX_GAP_MS = 1400;

/** Wall-clock gap between two fixture events, clamped so a run stays watchable. */
function gapFor(events: BotBondEvent[], i: number): number {
  if (i <= 0) return 0;
  const dt =
    new Date(events[i].occurredAt).getTime() -
    new Date(events[i - 1].occurredAt).getTime();
  if (!Number.isFinite(dt)) return 260;
  return Math.min(Math.max(dt, MIN_GAP_MS), MAX_GAP_MS);
}

export type ScenarioSpec = { id: string; file: string };

export type LaneState = {
  id: string;
  fixture: Fixture | null;
  view: ViewState;
  cursor: number;
  total: number;
  playing: boolean;
  finished: boolean;
};

/**
 * Every scenario runs on its own clock. Switching tabs changes which one you
 * are looking at, not whether it is running — during a demo you jump to another
 * scenario to make a point and expect to come back to a run still in progress.
 *
 * One interval drives all lanes. Each lane accumulates elapsed time and
 * advances when its own next gap has passed, so the original pacing of each
 * fixture survives.
 */
export function useMultiPlayer(specs: ScenarioSpec[]) {
  const [fixtures, setFixtures] = useState<Record<string, Fixture | null>>({});
  const [cursors, setCursors] = useState<Record<string, number>>(() =>
    Object.fromEntries(specs.map((s) => [s.id, 0])),
  );
  const [playing, setPlaying] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(specs.map((s) => [s.id, false])),
  );
  const [speed, setSpeed] = useState(1);

  const elapsed = useRef<Record<string, number>>({});
  const fixturesRef = useRef(fixtures);
  const cursorsRef = useRef(cursors);
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);

  fixturesRef.current = fixtures;
  cursorsRef.current = cursors;
  playingRef.current = playing;
  speedRef.current = speed;

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      specs.map((s) =>
        fetch(`/fixtures/${s.file}.json`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((loaded) => {
      if (cancelled) return;
      const next: Record<string, Fixture | null> = {};
      specs.forEach((s, i) => {
        next[s.id] = loaded[i] as Fixture | null;
      });
      setFixtures(next);
    });
    return () => {
      cancelled = true;
    };
    // specs is a module-level constant in practice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const advanced: Record<string, number> = {};
      const stopped: string[] = [];

      for (const [id, isPlaying] of Object.entries(playingRef.current)) {
        if (!isPlaying) continue;
        const fx = fixturesRef.current[id];
        if (!fx) continue;

        const at = cursorsRef.current[id] ?? 0;
        if (at >= fx.events.length) {
          stopped.push(id);
          continue;
        }

        const acc = (elapsed.current[id] ?? 0) + TICK_MS * speedRef.current;
        const needed = at === 0 ? 0 : gapFor(fx.events, at);

        if (acc >= needed) {
          elapsed.current[id] = 0;
          advanced[id] = Math.min(at + 1, fx.events.length);
        } else {
          elapsed.current[id] = acc;
        }
      }

      if (Object.keys(advanced).length > 0) {
        setCursors((prev) => ({ ...prev, ...advanced }));
      }
      if (stopped.length > 0) {
        setCursors((prev) => prev);
        setPlaying((prev) => {
          const next = { ...prev };
          stopped.forEach((id) => {
            next[id] = false;
          });
          return next;
        });
      }
    }, TICK_MS);

    return () => clearInterval(timer);
  }, []);

  const lanes: Record<string, LaneState> = useMemo(() => {
    const out: Record<string, LaneState> = {};
    for (const s of specs) {
      const fx = fixtures[s.id] ?? null;
      const total = fx?.events.length ?? 0;
      const cursor = Math.min(cursors[s.id] ?? 0, total);
      out[s.id] = {
        id: s.id,
        fixture: fx,
        view: fx ? replay(fx.events, cursor) : replay([], 0),
        cursor,
        total,
        playing: playing[s.id] ?? false,
        finished: total > 0 && cursor >= total,
      };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtures, cursors, playing]);

  const play = useCallback((id: string) => {
    setCursors((prev) => {
      const fx = fixturesRef.current[id];
      const total = fx?.events.length ?? 0;
      if (total > 0 && (prev[id] ?? 0) >= total) {
        elapsed.current[id] = 0;
        return { ...prev, [id]: 0 };
      }
      return prev;
    });
    setPlaying((prev) => ({ ...prev, [id]: true }));
  }, []);

  const pause = useCallback((id: string) => {
    setPlaying((prev) => ({ ...prev, [id]: false }));
  }, []);

  const toggle = useCallback(
    (id: string) => {
      if (playingRef.current[id]) pause(id);
      else play(id);
    },
    [play, pause],
  );

  const reset = useCallback((id: string) => {
    elapsed.current[id] = 0;
    setPlaying((prev) => ({ ...prev, [id]: false }));
    setCursors((prev) => ({ ...prev, [id]: 0 }));
  }, []);

  const step = useCallback((id: string) => {
    setPlaying((prev) => ({ ...prev, [id]: false }));
    setCursors((prev) => {
      const total = fixturesRef.current[id]?.events.length ?? 0;
      return { ...prev, [id]: Math.min((prev[id] ?? 0) + 1, total) };
    });
  }, []);

  const jumpToEnd = useCallback((id: string) => {
    setPlaying((prev) => ({ ...prev, [id]: false }));
    setCursors((prev) => ({
      ...prev,
      [id]: fixturesRef.current[id]?.events.length ?? 0,
    }));
  }, []);

  const playAll = useCallback(() => {
    setCursors(() =>
      Object.fromEntries(specs.map((s) => [s.id, 0])),
    );
    specs.forEach((s) => {
      elapsed.current[s.id] = 0;
    });
    setPlaying(() => Object.fromEntries(specs.map((s) => [s.id, true])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetAll = useCallback(() => {
    specs.forEach((s) => {
      elapsed.current[s.id] = 0;
    });
    setPlaying(() => Object.fromEntries(specs.map((s) => [s.id, false])));
    setCursors(() => Object.fromEntries(specs.map((s) => [s.id, 0])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    lanes,
    speed,
    setSpeed,
    play,
    pause,
    toggle,
    reset,
    step,
    jumpToEnd,
    playAll,
    resetAll,
  };
}
