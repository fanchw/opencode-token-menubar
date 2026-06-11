import { contextBridge } from "electron"

contextBridge.exposeInMainWorld("tokenMetrics", {})
