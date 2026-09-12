import { resolve } from "node:path";
import { loadConfiguration } from "./config.js";
import { assertLoopbackHost, createApplicationServer } from "./http-server.js";
import { SafeLogger } from "./safe-logger.js";

const logger = new SafeLogger();
const configuration = await loadConfiguration(process.env.ACTION_INSIGHTS_CONFIG);
assertLoopbackHost(configuration.app.bindHost);

const publicDirectory = resolve(process.cwd(), "dist", "public");
const server = createApplicationServer(configuration, { publicDirectory, logger });

server.listen(configuration.app.port, configuration.app.bindHost, () => {
  logger.info("service_started", {
    status: "ready",
    version: "0.1.0",
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
