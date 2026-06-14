import { contextBridge, ipcRenderer } from "electron"

import type { TokenMetricsApi } from "../shared/metrics.js"

const tokenMetrics: TokenMetricsApi = {
  getDashboardData: (filters) => ipcRenderer.invoke("metrics:get-dashboard-data", filters),
  getSummary: (filters) => ipcRenderer.invoke("metrics:get-summary", filters),
  getRecent: (filters) => ipcRenderer.invoke("metrics:get-recent", filters),
  getRanking: (filters) => ipcRenderer.invoke("metrics:get-ranking", filters),
  getTrends: (filters) => ipcRenderer.invoke("metrics:get-trends", filters),
  installPlugin: () => ipcRenderer.invoke("plugin:install"),
  onDashboardUpdated: (callback) => {
    const listener = (_event: unknown, payload: { reason: "new-data" | "catalog-sync" }) => callback(payload)
    ipcRenderer.on("metrics:dashboard-updated", listener)

    return () => ipcRenderer.removeListener("metrics:dashboard-updated", listener)
  },
}

contextBridge.exposeInMainWorld("tokenMetrics", tokenMetrics)
