import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export interface DiscoveredInstance {
  url: string;
  password?: string;
}

// v2 daemon 把端口写入 server.json，可能的路径
function candidateServerJsonPaths(): string[] {
  const paths: string[] = [];
  if (process.env.XDG_STATE_HOME) {
    paths.push(join(process.env.XDG_STATE_HOME, "opencode", "server.json"));
  }
  paths.push(join(homedir(), ".local", "state", "opencode", "server.json"));
  return paths;
}

// 读 v2 daemon 的 server.json
function readServerJson(): DiscoveredInstance | null {
  for (const p of candidateServerJsonPaths()) {
    try {
      const data = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      if (typeof data.url === "string" && data.url) {
        const passwordPath = join(dirname(p), "password");
        const password = existsSync(passwordPath)
          ? readFileSync(passwordPath, "utf8").trim() || undefined
          : undefined;
        return { url: data.url, password };
      }
    } catch {
      // 文件不存在或格式错，跳过
    }
  }
  return null;
}

// 探活指定 URL 的 OpenCode 实例
async function probeUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/config`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// 自动发现正在运行的 OpenCode 实例
// 优先级：v2 daemon server.json → 默认端口 4096 探活 → null
export async function discoverOpenCode(): Promise<DiscoveredInstance | null> {
  // 1. v2 daemon server.json
  const fromFile = readServerJson();
  if (fromFile && (await probeUrl(fromFile.url))) {
    return fromFile;
  }

  // 2. 默认端口 4096
  const defaultUrl = "http://localhost:4096";
  if (await probeUrl(defaultUrl)) {
    return { url: defaultUrl };
  }

  return null;
}
