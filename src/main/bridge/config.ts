import { readFileSync } from "node:fs"

export interface BridgeConfig {
  telegram: { botToken: string }
  opencode: { baseUrl: string }
  allowlist?: number[]
  autoApprove: boolean
  throttleMs: number
}

export function readBridgeConfig(configPath: string): BridgeConfig | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"))
  } catch {
    return undefined
  }

  if (!raw || typeof raw !== "object") return undefined
  const obj = raw as Record<string, unknown>
  const botToken = obj.telegram && (obj.telegram as Record<string, unknown>).botToken
  if (typeof botToken !== "string" || !botToken) return undefined

  const opencode = (obj.opencode as Record<string, unknown> | undefined) ?? {}
  const baseUrl = typeof opencode.baseUrl === "string" ? opencode.baseUrl : "http://localhost:4096"

  const allowlist = Array.isArray(obj.allowlist)
    ? obj.allowlist.filter((v): v is number => typeof v === "number")
    : undefined

  return {
    telegram: { botToken },
    opencode: { baseUrl },
    allowlist: allowlist && allowlist.length > 0 ? allowlist : undefined,
    autoApprove: obj.autoApprove === true,
    throttleMs: typeof obj.throttleMs === "number" && Number.isFinite(obj.throttleMs) ? obj.throttleMs : 1500,
  }
}
