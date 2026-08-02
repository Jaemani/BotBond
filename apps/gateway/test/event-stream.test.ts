import { describe, expect, it } from "vitest";
import type { BotBondEvent } from "@botbond/contracts";
import { eventsAfterLastId, SessionEventHub, serializeSse } from "../src/event-stream.js";

const event: BotBondEvent = {
  eventId: "evt_live",
  sessionId: "ses_live",
  occurredAt: "2026-08-02T12:00:00.000Z",
  type: "REQUEST_ALLOWED",
  data: { path: "/products" },
  traceId: "tr_live",
};

describe("live event stream", () => {
  it("publishes session-scoped events and unsubscribes", () => {
    const hub = new SessionEventHub();
    const received: BotBondEvent[] = [];
    const unsubscribe = hub.subscribe("ses_live", (next) => received.push(next));
    hub.publish(event);
    expect(received).toEqual([event]);
    unsubscribe();
    hub.publish({ ...event, eventId: "evt_after" });
    expect(received).toHaveLength(1);
    expect(hub.listenerCount("ses_live")).toBe(0);
  });

  it("resumes strictly after Last-Event-ID and replays all for an unknown id", () => {
    const later = { ...event, eventId: "evt_two", occurredAt: "2026-08-02T12:00:01.000Z" };
    expect(eventsAfterLastId([event, later], event.eventId)).toEqual([later]);
    expect(eventsAfterLastId([event, later], "evt_unknown")).toEqual([event, later]);
  });

  it("serializes shared event envelope as SSE", () => {
    const encoded = serializeSse(event);
    expect(encoded).toContain("id: evt_live");
    expect(encoded).toContain("event: REQUEST_ALLOWED");
    expect(JSON.parse(encoded.match(/data: (.*)\n\n/)?.[1] ?? "null")).toEqual(event);
  });
});
