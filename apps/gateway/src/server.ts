import { buildApp } from "./app.js";
import { repositoryFromEnvironment } from "./repository-factory.js";

const app = await buildApp({ repository: repositoryFromEnvironment() });
const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: "0.0.0.0", port });
