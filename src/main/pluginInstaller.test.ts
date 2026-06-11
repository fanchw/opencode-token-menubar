import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

import { installPlugin } from "./pluginInstaller.js";

describe("installPlugin", () => {
  test("copies bundled plugin to target path", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-plugin-installer-"));
    const sourcePath = join(root, "plugin", "token-metrics.ts");
    const targetPath = join(root, "config", "opencode", "plugin", "token-metrics.ts");

    await mkdir(join(root, "plugin"), { recursive: true });
    await writeFile(sourcePath, "export default {}\n");

    const result = await installPlugin({ sourcePath, targetPath });

    expect(result).toEqual({ installed: true, targetPath });
    expect(await readFile(targetPath, "utf8")).toBe("export default {}\n");
  });

  test("overwrites existing target when reinstalling", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-plugin-installer-"));
    const sourcePath = join(root, "plugin", "token-metrics.ts");
    const targetPath = join(root, "config", "opencode", "plugin", "token-metrics.ts");

    await mkdir(join(root, "plugin"), { recursive: true });
    await mkdir(join(root, "config", "opencode", "plugin"), { recursive: true });
    await writeFile(sourcePath, "export default { updated: true }\n");
    await writeFile(targetPath, "export default { old: true }\n");

    const result = await installPlugin({ sourcePath, targetPath });

    expect(result).toEqual({ installed: true, targetPath });
    expect(await readFile(targetPath, "utf8")).toBe("export default { updated: true }\n");
  });

  test("throws when source plugin does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-plugin-installer-"));
    const sourcePath = join(root, "plugin", "missing.ts");
    const targetPath = join(root, "config", "opencode", "plugin", "token-metrics.ts");

    await expect(installPlugin({ sourcePath, targetPath })).rejects.toThrow();
  });
});
