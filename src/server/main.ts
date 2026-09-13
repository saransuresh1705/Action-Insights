import { resolve } from "node:path";
import { APP_VERSION } from "../shared/contracts.js";
import { ConfigurationStore, defaultConfigurationPath, loadConfiguration } from "./config.js";
import { CollectionService } from "./collections.js";
import { assertLoopbackHost, createApplicationServer } from "./http-server.js";
import { SafeLogger } from "./safe-logger.js";
import { ScanCoordinator } from "./scan.js";
import { AppOpenScheduler } from "./scheduler.js";
import { MacOsKeychainSecretStore } from "./secrets.js";
import { LocalDataKeyProvider } from "./storage/crypto.js";
import { LocalDatabase } from "./storage/database.js";
import { WebexReadOnlyClient } from "./webex/client.js";
import { WebexReadOnlyHttpClient } from "./webex/http.js";
import { WebexMessageIngestionAdapter } from "./webex/ingestion.js";
import { WebexOAuthService } from "./webex/oauth.js";
import { WebexService } from "./webex/service.js";

const logger = new SafeLogger();
const configurationPath = process.env.ACTION_INSIGHTS_CONFIG ?? defaultConfigurationPath();
const configuration = await loadConfiguration(configurationPath);
const configurationStore = new ConfigurationStore(configurationPath, configuration);
assertLoopbackHost(configuration.app.bindHost);

const secretStore = new MacOsKeychainSecretStore();
const dataKeyProvider = new LocalDataKeyProvider(secretStore, configuration.storage.encryptionKeyRef);
const database = await LocalDatabase.open(configuration.storage.dataDirectory, dataKeyProvider);
const webexOAuth = new WebexOAuthService(configuration, secretStore);
const webexClient = new WebexReadOnlyClient(new WebexReadOnlyHttpClient());
const webex = new WebexService(webexOAuth, webexClient, database, configurationStore);
const collections = new CollectionService(database);
const scans = new ScanCoordinator(
  configuration,
  webexOAuth,
  new WebexMessageIngestionAdapter(webexClient),
  database,
  logger,
);
const scheduler = new AppOpenScheduler(configuration.scan.intervalMinutes, scans);

const publicDirectory = resolve(process.cwd(), "dist", "public");
const server = createApplicationServer(configuration, {
  publicDirectory,
  logger,
  webex,
  collections,
  scans,
  scheduler,
  configurationStore,
});

server.listen(configuration.app.port, configuration.app.bindHost, () => {
  scheduler.start();
  logger.info("service_started", {
    status: "ready",
    version: APP_VERSION,
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    scheduler.stop();
    server.close(() => {
      database.close();
      process.exit(0);
    });
  });
}
