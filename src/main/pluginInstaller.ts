import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface InstallPluginOptions {
  sourcePath: string;
  targetPath: string;
}

export interface InstallPluginResult {
  installed: true;
  targetPath: string;
}

export async function installPlugin({ sourcePath, targetPath }: InstallPluginOptions): Promise<InstallPluginResult> {
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);

  return { installed: true, targetPath };
}
