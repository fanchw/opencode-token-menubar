import { homedir } from "node:os";
import { join } from "node:path";

export interface AppPaths {
  configPath: string;
  jsonlPath: string;
  ingestPath: string;
  sqlitePath: string;
  pluginPath: string;
  pluginSharedPath: string;
  bridgeConfigPath: string;
  bundledPluginPath: string;
  bundledPluginSharedPath: string;
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
    pluginSharedPath: join(configPath, "shared", "pluginMetric.ts"),
    bridgeConfigPath: join(userDataPath, "bridge.json"),
    bundledPluginPath: join(appPath, "plugin", "token-metrics.ts"),
    bundledPluginSharedPath: join(appPath, "src", "shared", "pluginMetric.ts"),
  };
}
