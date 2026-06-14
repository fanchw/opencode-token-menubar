import { execFileSync } from "node:child_process"

export interface ModelCatalogEntry {
  provider: string
  model: string
}

let cachedEntries: ModelCatalogEntry[] | null = null

export function readOpenCodeModels(): ModelCatalogEntry[] {
  if (cachedEntries !== null) return cachedEntries

  try {
    const output = execFileSync("opencode", ["models"], {
      encoding: "utf-8",
      timeout: 5000,
    })
    cachedEntries = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const slashIndex = line.indexOf("/")
        if (slashIndex === -1) {
          return null
        }
        return {
          provider: line.slice(0, slashIndex).trim(),
          model: line.slice(slashIndex + 1).trim(),
        }
      })
      .filter((entry): entry is ModelCatalogEntry => entry !== null && entry.provider !== "" && entry.model !== "")
  } catch {
    cachedEntries = []
  }

  return cachedEntries
}

export function clearOpenCodeModelCache(): void {
  cachedEntries = null
}
