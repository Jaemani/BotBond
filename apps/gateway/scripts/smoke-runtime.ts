import { buildApp } from "../src/app.js";
import { loadBotBondIdl } from "../src/adapters.js";

const idl = loadBotBondIdl() as { address?: string };
if (!idl.address) throw new Error("BOTBOND_IDL_ADDRESS_MISSING");

const app = await buildApp();
const discovery = await app.inject({ method: "GET", url: "/.well-known/agent-access" });
if (discovery.statusCode !== 200) throw new Error(`GATEWAY_RUNTIME_SMOKE_FAILED:${discovery.statusCode}`);
await app.close();

console.log("Gateway compiled-runtime smoke passed", { programId: idl.address });
