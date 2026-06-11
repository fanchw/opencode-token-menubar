import { contextBridge, ipcRenderer } from "electron"

import type { TokenMetricsApi } from "../shared/metrics.js"

const tokenMetrics: TokenMetricsApi = {
  getDashboardData: () => ipcRenderer.invoke("metrics:get-dashboard-data"),
  installPlugin: () => ipcRenderer.invoke("plugin:install"),
}

contextBridge.exposeInMainWorld("tokenMetrics", tokenMetrics)
