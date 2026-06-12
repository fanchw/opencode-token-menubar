import { homedir } from "node:os";
import { join } from "node:path";

export interface AppPaths {
  configPath: string;
  jsonlPath: string;
  ingestPath: string;
  sqlitePath: string;
  pluginPath: string;
  bundledPluginPath: string;
}

export function resolveAppPaths(appPath = process.cwd(), userDataPath = process.cwd()): AppPaths {
  const configPath = join(homedir(), ".config", "opencode");
  const tokenMetricsPath = join(configPath, "token-metrics");

  return {
    configPath: join(configPath, "opencode.json"),
    jsonlPath: join(tokenMetricsPath, "events.jsonl"),
    ingestPath: join(tokenMetricsPath, "ingest.json"),
    sqlitePath: join(userDataPath, "metrics.db"),
    pluginPath: join(configPath, "plugins", "token-metrics.ts"),
    bundledPluginPath: join(appPath, "plugin", "token-metrics.ts"),
  };
}
