import { randomUUID } from "node:crypto";
import type { BotBondEvent } from "@botbond/contracts";
import { adaptersFromEnvironment } from "../src/adapters.js";
import { SystemClock } from "../src/clock.js";
import { DemoCommerceApi } from "../src/commerce.js";
import { processExpiredReservations } from "../src/expiry-processor.js";
import { repositoryFromEnvironment } from "../src/repository-factory.js";

const repository = repositoryFromEnvironment();
const adapters = adaptersFromEnvironment();
const clock = new SystemClock();
const commerce = new DemoCommerceApi(repository, clock);
await commerce.initialize();
const results = await processExpiredReservations({
  repository,
  commerce,
  payment: adapters.payment,
  bond: adapters.bond,
  clock,
  async emit(event: Omit<BotBondEvent, "eventId" | "occurredAt">) {
    await repository.appendEvent({ ...event, eventId: `evt_${randomUUID()}`, occurredAt: clock.now().toISOString() });
  },
});
console.log(JSON.stringify({ processed: results.length, results }));
