import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from "electron"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path, { dirname } from "node:path"
import chokidar, { type FSWatcher } from "chokidar"

import { compactJsonlFile, readJsonlEvents } from "./jsonlImporter.js"
import { startIngestServer, type IngestServerHandle } from "./ingestServer.js"
import { MetricsStore } from "./metricsStore.js"
import { resolveAppPaths, type AppPaths } from "./paths.js"
import { installPlugin } from "./pluginInstaller.js"
import { formatTokenUnit } from "../shared/metrics.js"
import type { DashboardData, DashboardFilters, MetricEvent } from "../shared/metrics.js"

let tray: Tray | null = null
let window: BrowserWindow | null = null
let store: MetricsStore | null = null
let watcher: FSWatcher | null = null
let ingestServer: IngestServerHandle | null = null
let paths: AppPaths | null = null
let importStatePath: string | null = null
let jsonlOffset = 0
let importErrors = 0
let isShuttingDown = false

interface ImportState {
  jsonlOffset: number
  importErrors: number
}

function readImportState(filePath: string): ImportState {
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8")) as Partial<ImportState>

    return {
      jsonlOffset:
        typeof data.jsonlOffset === "number" && Number.isFinite(data.jsonlOffset)
          ? data.jsonlOffset
          : 0,
      importErrors:
        typeof data.importErrors === "number" && Number.isFinite(data.importErrors)
          ? data.importErrors
          : 0,
    }
  } catch {
    return { jsonlOffset: 0, importErrors: 0 }
  }
}

function writeImportState() {
  if (!importStatePath) return

  mkdirSync(dirname(importStatePath), { recursive: true })
  writeFileSync(importStatePath, JSON.stringify({ jsonlOffset, importErrors }, null, 2))
}

function getDashboardPaths() {
  if (!paths) {
    throw new Error("App paths are not initialized")
  }

  return {
    jsonlPath: paths.jsonlPath,
    ingestPath: paths.ingestPath,
    sqlitePath: paths.sqlitePath,
    pluginPath: paths.pluginPath,
  }
}

function isPluginInstalled() {
  return paths ? existsSync(paths.pluginPath) : false
}

function getTodayRange() {
  const now = new Date()
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)

  return { dayStart: dayStart.toISOString(), dayEnd: dayEnd.toISOString() }
}

function getDefaultDashboardFilters(): DashboardFilters {
  const { dayStart, dayEnd } = getTodayRange()

  return { start: dayStart, end: dayEnd }
}

function broadcastDashboardUpdated() {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return

  window.webContents.send("metrics:dashboard-updated")
}

function normalizeDashboardFilters(filters: unknown): DashboardFilters {
  if (
    !filters
    || typeof filters !== "object"
    || typeof (filters as Partial<DashboardFilters>).start !== "string"
    || typeof (filters as Partial<DashboardFilters>).end !== "string"
    || !(filters as Partial<DashboardFilters>).start?.trim()
    || !(filters as Partial<DashboardFilters>).end?.trim()
  ) {
    return getDefaultDashboardFilters()
  }

  const normalized: DashboardFilters = {
    start: (filters as DashboardFilters).start,
    end: (filters as DashboardFilters).end,
  }
  if (Array.isArray((filters as Partial<DashboardFilters>).providers)) {
    normalized.providers = (filters as Partial<DashboardFilters>).providers?.filter(
      (provider): provider is string => typeof provider === "string",
    )
  }
  if (Array.isArray((filters as Partial<DashboardFilters>).models)) {
    normalized.models = (filters as Partial<DashboardFilters>).models?.filter(
      (model): model is string => typeof model === "string",
    )
  }

  return normalized
}

function getDashboardData(filters = getDefaultDashboardFilters()): DashboardData {
  if (!store || !paths) {
    throw new Error("Metrics store is not initialized")
  }

  const data = store.getDashboardData({ ...filters, recentLimit: 50 })

  return {
    ...data,
    importErrors,
    pluginInstalled: isPluginInstalled(),
    paths: getDashboardPaths(),
  }
}

function updateTrayTitle() {
  if (!tray || !store) return

  const data = getDashboardData()
  const recentSpeed = data.recent[0]?.tokensPerSecond
  if (typeof recentSpeed === "number" && recentSpeed > 0) {
    tray.setTitle(`OC ${Math.round(recentSpeed)}/s`)
  } else if (data.today.totalTokens > 0) {
    tray.setTitle(`OC ${formatTokenUnit(data.today.totalTokens)}`)
  } else {
    tray.setTitle("OC")
  }
}

async function installGlobalPlugin() {
  if (!paths) {
    throw new Error("App paths are not initialized")
  }

  const result = await installPlugin({
    sourcePath: paths.bundledPluginPath,
    targetPath: paths.pluginPath,
    sharedSourcePath: paths.bundledPluginSharedPath,
    sharedTargetPath: paths.pluginSharedPath,
    configPath: paths.configPath,
  })
  updateTrayMenu()
  broadcastDashboardUpdated()

  return result
}

function updateTrayMenu() {
  if (!tray) return

  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "Refresh",
      click: () => {
        if (!importNewEvents()) {
          broadcastDashboardUpdated()
        }
      },
    },
    {
      label: isPluginInstalled() ? "Reinstall Plugin" : "Install Plugin",
      click: () => {
        installGlobalPlugin().catch((error) => console.warn("Failed to install plugin", error))
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ]))
}

function createTrayIcon() {
  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;utf8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
        <path fill="black" d="M4 3h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v8h10V5H4Zm2 2h6v1.5H6V7Zm0 3h4v1.5H6V10Z"/>
      </svg>
    `)}`,
  )
  icon.setTemplateImage(true)

  return icon
}

function importNewEvents() {
  if (!store || !paths) return false

  const previousOffset = jsonlOffset
  const result = readJsonlEvents(paths.jsonlPath, jsonlOffset)
  const nextOffset = result.nextOffset
  importErrors += result.errors
  if (result.events.length > 0) {
    store.insertEvents(result.events)
    broadcastDashboardUpdated()
  }
  jsonlOffset = nextOffset
  if (nextOffset > previousOffset) {
    compactJsonlFile(paths.jsonlPath, nextOffset)
    jsonlOffset = 0
  }
  writeImportState()
  updateTrayTitle()

  return result.events.length > 0
}

function insertLocalMetric(event: MetricEvent) {
  if (!store) {
    throw new Error("Metrics store is not initialized")
  }

  store.insertEvents([event])
  updateTrayTitle()
  broadcastDashboardUpdated()
}

function watchMetricEvents() {
  if (!paths) return

  void watcher?.close()
  mkdirSync(dirname(paths.jsonlPath), { recursive: true })
  watcher = chokidar.watch(paths.jsonlPath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
  })
  watcher.on("add", importNewEvents)
  watcher.on("change", importNewEvents)
}

function createWindow() {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  window = new BrowserWindow({
    width: 520,
    height: 680,
    show: Boolean(rendererUrl),
    frame: false,
    resizable: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist/main/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(path.join(app.getAppPath(), "dist/renderer/index.html"))
  }
}

function toggleWindow() {
  if (!window || !tray) return
  if (window.isVisible()) {
    window.hide()
    return
  }

  const trayBounds = tray.getBounds()
  const windowBounds = window.getBounds()
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })
  const { x, y, width, height } = display.workArea
  const nextX = Math.min(
    Math.max(Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2), x),
    x + width - windowBounds.width,
  )
  const nextY = Math.min(
    Math.max(Math.round(trayBounds.y + trayBounds.height + 6), y),
    y + height - windowBounds.height,
  )

  window.setPosition(
    nextX,
    nextY,
    false,
  )
  window.show()
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    app.dock?.hide()
    app.setActivationPolicy("accessory")
  }

  const userDataPath = app.getPath("userData")
  paths = resolveAppPaths(app.getAppPath(), userDataPath)
  importStatePath = path.join(userDataPath, "import-state.json")
  const importState = readImportState(importStatePath)
  jsonlOffset = importState.jsonlOffset
  importErrors = importState.importErrors
  store = new MetricsStore(paths.sqlitePath)
  try {
    ingestServer = await startIngestServer({
      ingestPath: paths.ingestPath,
      onMetric: insertLocalMetric,
    })
  } catch (error) {
    console.warn("Failed to start ingest server", error)
  }
  importNewEvents()
  watchMetricEvents()

  ipcMain.handle("metrics:get-dashboard-data", (_event, filters: unknown) => {
    return getDashboardData(normalizeDashboardFilters(filters))
  })
  ipcMain.handle("plugin:install", () => installGlobalPlugin())

  createWindow()
  tray = new Tray(createTrayIcon())
  tray.setTitle("OC")
  tray.setToolTip("OpenCode Token Menubar")
  tray.on("click", toggleWindow)
  updateTrayMenu()
  updateTrayTitle()
})

app.on("window-all-closed", () => {
})

app.on("before-quit", (event) => {
  if (isShuttingDown) return

  event.preventDefault()
  isShuttingDown = true

  void (async () => {
    try {
      try {
        await watcher?.close()
      } catch (error) {
        console.warn("Failed to close metrics watcher", error)
      } finally {
        watcher = null
      }

      try {
        await ingestServer?.stop()
      } catch (error) {
        console.warn("Failed to stop ingest server", error)
      } finally {
        ingestServer = null
      }

      try {
        store?.close()
      } catch (error) {
        console.warn("Failed to close metrics store", error)
      } finally {
        store = null
      }
    } finally {
      app.quit()
    }
  })()
})
