import { describe, expect, it, vi } from "vitest";
import type { BotBondEvent } from "./types";
import { consumeEventStream, parseSseBlock } from "./usePlayer";

const event = (eventId: string): BotBondEvent => ({
  eventId,
  sessionId: "ses_sse_test",
  occurredAt: "2026-08-03T00:00:00.000Z",
  type: "SESSION_ACTIVATED",
  data: {},
  traceId: "tr_sse_test",
});

describe("authenticated SSE client", () => {
  it("parses id and multiline data while ignoring comments", () => {
    expect(parseSseBlock(": heartbeat")).toEqual({ id: undefined });
    expect(parseSseBlock("id: evt_1\ndata: {\"a\":\ndata: 1}")).toEqual({
      id: "evt_1",
      data: "{\"a\":\n1}",
    });
  });

  it("sends bearer and Last-Event-ID, ignores heartbeat, and handles split CRLF blocks", async () => {
    const expected = event("evt_2");
    const encoder = new TextEncoder();
    const chunks = [
      ": heartbeat\r",
      "\n\r\nid: evt_2\r\ndata: " + JSON.stringify(expected).slice(0, 25),
      JSON.stringify(expected).slice(25) + "\r\n\r\n",
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const received: BotBondEvent[] = [];
    const lastId = await consumeEventStream(
      { url: "https://gateway.test/events", token: "secret-token" },
      "evt_1",
      new AbortController().signal,
      (value) => received.push(value),
    );
    expect(fetchMock).toHaveBeenCalledWith("https://gateway.test/events", expect.objectContaining({
      headers: {
        Accept: "text/event-stream",
        Authorization: "Bearer secret-token",
        "Last-Event-ID": "evt_1",
      },
      cache: "no-store",
    }));
    expect(received).toEqual([expected]);
    expect(lastId).toBe("evt_2");
    vi.unstubAllGlobals();
  });

  it("fails terminally on unauthorized streams", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(consumeEventStream(
      { url: "https://gateway.test/events", token: "bad-token" },
      null,
      new AbortController().signal,
      () => undefined,
    )).rejects.toThrow("SSE 401");
    vi.unstubAllGlobals();
  });
});
