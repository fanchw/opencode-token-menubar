import { contextBridge, ipcRenderer } from "electron"

import type { TokenMetricsApi } from "../shared/metrics.js"

const tokenMetrics: TokenMetricsApi = {
  getDashboardData: (filters) => ipcRenderer.invoke("metrics:get-dashboard-data", filters),
  installPlugin: () => ipcRenderer.invoke("plugin:install"),
  onDashboardUpdated: (callback) => {
    const listener = () => callback()
    ipcRenderer.on("metrics:dashboard-updated", listener)

    return () => ipcRenderer.removeListener("metrics:dashboard-updated", listener)
  },
}

contextBridge.exposeInMainWorld("tokenMetrics", tokenMetrics)
