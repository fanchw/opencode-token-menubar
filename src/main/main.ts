import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from "electron"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path, { dirname } from "node:path"
import chokidar, { type FSWatcher } from "chokidar"

import { compactJsonlFile, readJsonlEvents } from "./jsonlImporter.js"
import { startIngestServer, type IngestServerHandle } from "./ingestServer.js"
import { MetricsStore } from "./metricsStore.js"
import { resolveAppPaths, type AppPaths } from "./paths.js"
import { installPlugin } from "./pluginInstaller.js"
import { EventBuffer } from "./eventBuffer.js"
import { formatTokenUnit } from "../shared/metrics.js"
import type { DashboardData, DashboardFilters, MetricEvent } from "../shared/metrics.js"
import { readOpenCodeModels } from "./opencodeModels.js"

let tray: Tray | null = null
let window: BrowserWindow | null = null
let store: MetricsStore | null = null
let watcher: FSWatcher | null = null
let ingestServer: IngestServerHandle | null = null
let eventBuffer: EventBuffer | null = null
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
  const rawPage = (filters as Partial<DashboardFilters>).recentPage
  if (typeof rawPage === "number" && Number.isFinite(rawPage) && rawPage >= 1) {
    normalized.recentPage = Math.floor(rawPage)
  }
  const rawPageSize = (filters as Partial<DashboardFilters>).recentPageSize
  if (typeof rawPageSize === "number" && Number.isFinite(rawPageSize) && rawPageSize >= 1) {
    normalized.recentPageSize = Math.floor(rawPageSize)
  }

  return normalized
}

function syncModelCatalog() {
  if (!store) return
  try {
    const entries = readOpenCodeModels()
    if (entries.length) {
      store.syncCatalog(entries)
    }
  } catch {
    // opencode 命令不可用，跳过
  }
}

function getDashboardData(filters = getDefaultDashboardFilters()): DashboardData {
  if (!store || !paths) {
    throw new Error("Metrics store is not initialized")
  }

  const data = store.getDashboardData(filters)

  const knownProviders = new Set(data.providers.map((option) => option.value))
  const catalogProviders = store
    .getCatalogProviders()
    .filter((value) => !knownProviders.has(value))
    .map((value) => ({ value, requestCount: 0, totalTokens: 0 }))

  const knownModels = new Set(data.models.map((option) => option.value))
  const catalogModels = store
    .getCatalogModels()
    .filter((value) => !knownModels.has(value))
    .map((value) => ({ value, requestCount: 0, totalTokens: 0 }))

  return {
    ...data,
    providers: [...data.providers, ...catalogProviders],
    models: [...data.models, ...catalogModels],
    modelProviders: store.getModelProviderMap(),
    importErrors,
    pluginInstalled: isPluginInstalled(),
    paths: getDashboardPaths(),
  }
}

function updateTrayTitle() {
  if (!tray || !store) return

  const { dayStart, dayEnd } = getTodayRange()
  const summary = store.getTraySummary(dayStart, dayEnd)
  if (summary.latestSpeed != null && summary.latestSpeed > 0) {
    tray.setToolTip(`OpenCode · ${Math.round(summary.latestSpeed)} tok/s · ${formatTokenUnit(summary.totalTokens)} today`)
  } else if (summary.totalTokens > 0) {
    tray.setToolTip(`OpenCode · ${formatTokenUnit(summary.totalTokens)} today`)
  } else {
    tray.setToolTip("OpenCode Token Menubar")
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
  broadcastDashboardUpdated()

  return result
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
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
  ])
}

function createTrayIcon() {
  const iconPath = path.join(app.getAppPath(), "assets/trayIcon.png")
  const icon = nativeImage.createFromPath(iconPath)
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
  eventBuffer?.push(event)
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

  window.on("blur", () => {
    setTimeout(() => {
      if (window?.isVisible() && !window.isFocused()) {
        window.hide()
      }
    }, 150)
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
  if (process.env.ELECTRON_RENDERER_URL) {
    app.setName("opencode-token-menubar-dev")
  }

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
  eventBuffer = new EventBuffer({
    flushMs: 200,
    onFlush: (events) => {
      if (!store) return
      store.insertEvents(events)
      updateTrayTitle()
      broadcastDashboardUpdated()
    },
  })
  syncModelCatalog()
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
  tray.setToolTip("OpenCode Token Menubar")
  tray.on("click", toggleWindow)
  tray.on("right-click", () => tray?.popUpContextMenu(buildTrayMenu()))
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

      eventBuffer?.flush()
      eventBuffer = null

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
