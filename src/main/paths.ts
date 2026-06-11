import { homedir } from "node:os";
import { join } from "node:path";

export interface AppPaths {
  jsonlPath: string;
  sqlitePath: string;
  pluginPath: string;
  bundledPluginPath: string;
}

export function resolveAppPaths(appPath = process.cwd(), userDataPath = process.cwd()): AppPaths {
  const configPath = join(homedir(), ".config", "opencode");

  return {
    jsonlPath: join(configPath, "token-metrics", "events.jsonl"),
    sqlitePath: join(userDataPath, "metrics.db"),
    pluginPath: join(configPath, "plugin", "token-metrics.ts"),
    bundledPluginPath: join(appPath, "plugin", "token-metrics.ts"),
  };
}
