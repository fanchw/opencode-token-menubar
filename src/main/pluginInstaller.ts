import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface InstallPluginOptions {
  sourcePath: string;
  targetPath: string;
  sharedSourcePath?: string;
  sharedTargetPath?: string;
  configPath?: string;
}

export interface InstallPluginResult {
  installed: true;
  targetPath: string;
}

const pluginReference = "./plugins/token-metrics.ts";

async function registerPlugin(configPath: string) {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    config = {};
  }

  const plugins = Array.isArray(config.plugin) ? config.plugin.filter((item): item is string => typeof item === "string") : [];
  if (!plugins.includes(pluginReference)) {
    plugins.push(pluginReference);
  }
  config.plugin = plugins;

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export async function installPlugin({ sourcePath, targetPath, sharedSourcePath, sharedTargetPath, configPath }: InstallPluginOptions): Promise<InstallPluginResult> {
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  if (sharedSourcePath && sharedTargetPath) {
    await mkdir(dirname(sharedTargetPath), { recursive: true });
    await copyFile(sharedSourcePath, sharedTargetPath);
  }
  if (configPath) {
    await registerPlugin(configPath);
  }

  return { installed: true, targetPath };
}
