import { EventEmitter } from "node:events";
import type { BotBondEvent } from "@botbond/contracts";

export class SessionEventHub {
  private readonly emitter = new EventEmitter();

  publish(event: BotBondEvent): void {
    this.emitter.emit(event.sessionId, structuredClone(event));
  }

  subscribe(sessionId: string, listener: (event: BotBondEvent) => void): () => void {
    this.emitter.on(sessionId, listener);
    return () => this.emitter.off(sessionId, listener);
  }

  listenerCount(sessionId: string): number {
    return this.emitter.listenerCount(sessionId);
  }
}

export function eventsAfterLastId(events: BotBondEvent[], lastEventId?: string): BotBondEvent[] {
  if (!lastEventId) return events;
  const index = events.findIndex((event) => event.eventId === lastEventId);
  return index < 0 ? events : events.slice(index + 1);
}

export function serializeSse(event: BotBondEvent): string {
  return `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
