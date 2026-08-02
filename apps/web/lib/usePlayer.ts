"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BotBondEvent, Fixture } from "./types";
import { replay } from "./reducer";

const BASE_GAP_MS = 260;
const MAX_GAP_MS = 1400;

/** Wall-clock gap between two fixture events, clamped so the demo stays inside 3 minutes. */
function gapFor(events: BotBondEvent[], i: number): number {
  if (i <= 0) return 0;
  const dt =
    new Date(events[i].occurredAt).getTime() - new Date(events[i - 1].occurredAt).getTime();
  return Math.min(Math.max(dt, 90), MAX_GAP_MS) || BASE_GAP_MS;
}

export function usePlayer(fixture: Fixture | null) {
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedName = useRef<string | null>(null);

  const total = fixture?.events.length ?? 0;

  // Swapping fixtures mid-playback must not leave the cursor pointing past the
  // end of the new event list. Reset during render, before anything reads it.
  if (fixture && loadedName.current !== fixture.name) {
    loadedName.current = fixture.name;
    if (cursor !== 0) setCursor(0);
    if (playing) setPlaying(false);
  }

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [fixture?.name, clear]);

  useEffect(() => {
    if (!playing || !fixture) return;
    if (cursor >= total) {
      setPlaying(false);
      return;
    }
    const delay = gapFor(fixture.events, cursor) / speed;
    timer.current = setTimeout(() => setCursor((c) => c + 1), delay);
    return clear;
  }, [playing, cursor, total, speed, fixture, clear]);

  const play = useCallback(() => {
    if (!fixture) return;
    setCursor((c) => (c >= total ? 0 : c));
    setPlaying(true);
  }, [fixture, total]);

  const pause = useCallback(() => setPlaying(false), []);
  const reset = useCallback(() => {
    clear();
    setPlaying(false);
    setCursor(0);
  }, [clear]);
  const step = useCallback(() => {
    setPlaying(false);
    setCursor((c) => Math.min(c + 1, total));
  }, [total]);
  const jumpToEnd = useCallback(() => {
    clear();
    setPlaying(false);
    setCursor(total);
  }, [clear, total]);

  const safeCursor = Math.min(cursor, total);
  const view = fixture ? replay(fixture.events, safeCursor) : replay([], 0);
  const lastEvent =
    safeCursor > 0 && fixture ? (fixture.events[safeCursor - 1] ?? null) : null;

  return {
    view, cursor, total, playing, speed, lastEvent,
    play, pause, reset, step, jumpToEnd, setSpeed,
  };
}
