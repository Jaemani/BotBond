import { readFileSync, writeFileSync } from "node:fs";
import { buildApp } from "../src/app.js";

const app = await buildApp();
await app.ready();
const document = app.swagger();
writeFileSync(new URL("../openapi.json", import.meta.url), `${JSON.stringify(document, null, 2)}\n`);
const written = JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8"));
if (written.info?.title !== "BotBond Agent Access Gateway") throw new Error("OPENAPI_EXPORT_FAILED");
await app.close();
