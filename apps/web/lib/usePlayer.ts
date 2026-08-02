"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BotBondEvent, Fixture } from "./types";
import { replay } from "./reducer";

const BASE_GAP_MS = 260;
const MAX_GAP_MS = 1400;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

class TerminalSseError extends Error {}

export type LiveEventStream = {
  url: string;
  token: string;
};

/** Wall-clock gap between two fixture events, clamped so demo stays inside 3 minutes. */
function gapFor(events: BotBondEvent[], i: number): number {
  if (i <= 0) return 0;
  const dt =
    new Date(events[i].occurredAt).getTime() - new Date(events[i - 1].occurredAt).getTime();
  return Math.min(Math.max(dt, 90), MAX_GAP_MS) || BASE_GAP_MS;
}

function parseSseBlock(block: string): { id?: string; data?: string } {
  let id: string | undefined;
  const data: string[] = [];
  for (const line of block.replace(/\r/g, "").split("\n")) {
    if (line.startsWith("id:")) id = line.slice(3).trimStart();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return { id, ...(data.length > 0 ? { data: data.join("\n") } : {}) };
}

async function consumeEventStream(
  config: LiveEventStream,
  lastEventId: string | null,
  signal: AbortSignal,
  onEvent: (event: BotBondEvent) => void,
): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    Authorization: `Bearer ${config.token}`,
  };
  if (lastEventId) headers["Last-Event-ID"] = lastEventId;
  const response = await fetch(config.url, { headers, signal, cache: "no-store" });
  if (response.status === 401 || response.status === 403) {
    throw new TerminalSseError(`SSE ${response.status}`);
  }
  if (!response.ok || !response.body) {
    throw new Error(`SSE ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let trailingCarriageReturn = false;
  let latestId = lastEventId;
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    let chunk = decoder.decode(value, { stream: true });
    if (trailingCarriageReturn) {
      chunk = `\r${chunk}`;
      trailingCarriageReturn = false;
    }
    if (chunk.endsWith("\r")) {
      chunk = chunk.slice(0, -1);
      trailingCarriageReturn = true;
    }
    buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseBlock(block);
      // Heartbeat blocks contain comments only. Parsing them as events would create duplicates.
      if (parsed.data) {
        const event = JSON.parse(parsed.data) as BotBondEvent;
        latestId = parsed.id ?? event.eventId;
        onEvent(event);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  return latestId;
}

function waitForReconnect(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function usePlayer(fixture: Fixture | null, live: LiveEventStream | null = null) {
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [liveEvents, setLiveEvents] = useState<BotBondEvent[]>([]);
  const [liveClockMs, setLiveClockMs] = useState(0);
  const [liveStatus, setLiveStatus] = useState<"OFF" | "CONNECTING" | "LIVE" | "RECONNECTING" | "ERROR">("OFF");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedName = useRef<string | null>(null);
  const fixtureName = fixture?.name ?? null;
  const liveUrl = live?.url ?? null;
  const liveToken = live?.token ?? null;

  const events = live ? liveEvents : fixture?.events ?? [];
  const total = events.length;

  useEffect(() => {
    if (!live && fixture && loadedName.current !== fixture.name) {
      loadedName.current = fixture.name;
      setCursor(0);
      setPlaying(false);
    }
  }, [fixture, live]);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [fixtureName, liveUrl, clear]);

  useEffect(() => {
    if (!liveUrl || !liveToken) {
      setLiveEvents([]);
      setLiveStatus("OFF");
      return;
    }
    const config: LiveEventStream = { url: liveUrl, token: liveToken };
    const controller = new AbortController();
    let lastEventId: string | null = null;
    let reconnects = 0;
    const seen = new Set<string>();
    setCursor(0);
    setPlaying(false);
    setLiveEvents([]);

    const run = async (): Promise<void> => {
      while (!controller.signal.aborted) {
        setLiveStatus(reconnects === 0 ? "CONNECTING" : "RECONNECTING");
        try {
          lastEventId = await consumeEventStream(config, lastEventId, controller.signal, (event) => {
            lastEventId = event.eventId;
            if (seen.has(event.eventId)) return;
            seen.add(event.eventId);
            reconnects = 0;
            setLiveStatus("LIVE");
            setLiveEvents((current) => [...current, event]);
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          setLiveStatus("ERROR");
          if (error instanceof TerminalSseError) return;
        }
        reconnects += 1;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** Math.min(reconnects - 1, 4), RECONNECT_MAX_MS);
        await waitForReconnect(delay, controller.signal);
      }
    };
    void run();
    return () => controller.abort();
  }, [liveUrl, liveToken]);

  useEffect(() => {
    if (!liveUrl) return;
    setLiveClockMs(Date.now());
    const interval = setInterval(() => setLiveClockMs(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [liveUrl]);

  useEffect(() => {
    if (live) {
      setCursor(total);
      return;
    }
    if (!playing || !fixture) return;
    if (cursor >= total) {
      setPlaying(false);
      return;
    }
    const delay = gapFor(events, cursor) / speed;
    timer.current = setTimeout(() => setCursor((c) => c + 1), delay);
    return clear;
  }, [playing, cursor, total, speed, fixture, live, events, clear]);

  const play = useCallback(() => {
    if (!fixture || live) return;
    setCursor((c) => (c >= total ? 0 : c));
    setPlaying(true);
  }, [fixture, live, total]);
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
  const view = useMemo(() => {
    const next = replay(events, safeCursor);
    if (!live || !next.reservation?.expiresAt || next.reservation.status !== "HELD") return next;
    const secondsRemaining = Math.max(
      0,
      Math.ceil((new Date(next.reservation.expiresAt).getTime() - liveClockMs) / 1000),
    );
    return { ...next, reservation: { ...next.reservation, secondsRemaining } };
  }, [events, safeCursor, live, liveClockMs]);
  const lastEvent = safeCursor > 0 ? events[safeCursor - 1] ?? null : null;

  return {
    view, cursor: safeCursor, total, playing, speed, lastEvent, liveStatus,
    play, pause, reset, step, jumpToEnd, setSpeed,
  };
}
