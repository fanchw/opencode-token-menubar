import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, screen, Tray } from "electron"
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
import type { DashboardData, DashboardFilters, MetricEvent, SummaryResponse, DashboardUpdatePayload } from "../shared/metrics.js"
import { readOpenCodeModels } from "./opencodeModels.js"
import { readBridgeConfig } from "./bridge/config.js"
import { discoverOpenCode } from "./bridge/discovery.js"
import { TelegramAdapter } from "./bridge/adapter/telegram.js"
import { OpenCodeProxy } from "./bridge/proxy/opencode.js"
import { Bridge } from "./bridge/bridge.js"

interface AppState {
  tray: Tray | null
  window: BrowserWindow | null
  store: MetricsStore | null
  watcher: FSWatcher | null
  ingestServer: IngestServerHandle | null
  eventBuffer: EventBuffer | null
  paths: AppPaths | null
  bridge: Bridge | null
  importStatePath: string | null
  jsonlOffset: number
  importErrors: number
  isShuttingDown: boolean
}

const state: AppState = {
  tray: null,
  window: null,
  store: null,
  watcher: null,
  ingestServer: null,
  eventBuffer: null,
  paths: null,
  bridge: null,
  importStatePath: null,
  jsonlOffset: 0,
  importErrors: 0,
  isShuttingDown: false,
}

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
  if (!state.importStatePath) return

  mkdirSync(dirname(state.importStatePath), { recursive: true })
  writeFileSync(
    state.importStatePath,
    JSON.stringify({ jsonlOffset: state.jsonlOffset, importErrors: state.importErrors }, null, 2),
  )
}

function getDashboardPaths() {
  if (!state.paths) {
    throw new Error("App paths are not initialized")
  }

  return {
    jsonlPath: state.paths.jsonlPath,
    ingestPath: state.paths.ingestPath,
    sqlitePath: state.paths.sqlitePath,
    pluginPath: state.paths.pluginPath,
  }
}

function isPluginInstalled() {
  return state.paths ? existsSync(state.paths.pluginPath) : false
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

function broadcastDashboardUpdated(payload: DashboardUpdatePayload = { reason: "new-data" }) {
  if (!state.window || state.window.isDestroyed() || state.window.webContents.isDestroyed()) return

  state.window.webContents.send("metrics:dashboard-updated", payload)
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
  if (!state.store) return
  try {
    const entries = readOpenCodeModels()
    if (entries.length) {
      state.store.syncCatalog(entries)
    }
  } catch {
    // opencode 命令不可用，跳过
  }
}

function getDashboardData(filters = getDefaultDashboardFilters()): DashboardData {
  if (!state.store || !state.paths) {
    throw new Error("Metrics store is not initialized")
  }

  const data = state.store.getDashboardData(filters)

  const knownProviders = new Set(data.providers.map((option) => option.value))
  const catalogProviders = state.store
    .getCatalogProviders()
    .filter((value) => !knownProviders.has(value))
    .map((value) => ({ value, requestCount: 0, totalTokens: 0 }))

  const knownModels = new Set(data.models.map((option) => option.value))
  const catalogModels = state.store
    .getCatalogModels()
    .filter((value) => !knownModels.has(value))
    .map((value) => ({ value, requestCount: 0, totalTokens: 0 }))

  return {
    ...data,
    providers: [...data.providers, ...catalogProviders],
    models: [...data.models, ...catalogModels],
    modelProviders: state.store.getModelProviderMap(),
    importErrors: state.importErrors,
    pluginInstalled: isPluginInstalled(),
    paths: getDashboardPaths(),
  }
}

function getSummaryData(filters = getDefaultDashboardFilters()): SummaryResponse {
  if (!state.store || !state.paths) {
    throw new Error("Metrics store is not initialized")
  }

  const summary = state.store.getSummary(filters)
  const { providers: dataProviders, models: dataModels } = state.store.getFilterOptions(filters)

  const knownProviders = new Set(dataProviders.map((option) => option.value))
  const catalogProviders = state.store
    .getCatalogProviders()
    .filter((value) => !knownProviders.has(value))
    .map((value) => ({ value, requestCount: 0, totalTokens: 0 }))

  const knownModels = new Set(dataModels.map((option) => option.value))
  const catalogModels = state.store
    .getCatalogModels()
    .filter((value) => !knownModels.has(value))
    .map((value) => ({ value, requestCount: 0, totalTokens: 0 }))

  return {
    today: summary,
    providers: [...dataProviders, ...catalogProviders],
    models: [...dataModels, ...catalogModels],
    modelProviders: state.store.getModelProviderMap(),
    importErrors: state.importErrors,
    pluginInstalled: isPluginInstalled(),
    paths: getDashboardPaths(),
  }
}

function updateTrayTitle() {
  if (!state.tray || !state.store) return

  const { dayStart, dayEnd } = getTodayRange()
  const summary = state.store.getTraySummary(dayStart, dayEnd)
  if (summary.latestSpeed != null && summary.latestSpeed > 0) {
    state.tray.setToolTip(`OpenCode · ${Math.round(summary.latestSpeed)} tok/s · ${formatTokenUnit(summary.totalTokens)} today`)
  } else if (summary.totalTokens > 0) {
    state.tray.setToolTip(`OpenCode · ${formatTokenUnit(summary.totalTokens)} today`)
  } else {
    state.tray.setToolTip("OpenCode Token Menubar")
  }
}

async function installGlobalPlugin() {
  if (!state.paths) {
    throw new Error("App paths are not initialized")
  }

  const result = await installPlugin({
    sourcePath: state.paths.bundledPluginPath,
    targetPath: state.paths.pluginPath,
    sharedSourcePath: state.paths.bundledPluginSharedPath,
    sharedTargetPath: state.paths.pluginSharedPath,
    configPath: state.paths.configPath,
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

// 内嵌 tray 图标 base64，避免 asar 路径问题
// prettier-ignore
const trayIconBase64 = "iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAC/ElEQVR4nOyZvWsUQRjGH087G+U6hVjEKBZBVGJhkzsLPbA4Y6FCivMD7ESxEATjrV4grbZpJIUgFicpBLEw22pQBCs901xhd5g/QI3vy8zevbfszM5udi+s3A8edmZuZ+fJ7LvzlRIKRgkFY2w4bwpneA+yY5I0TZog7dNlm6Qu6StpAxmwXcMnSfOkOpRhG2x4lfSC9Bkp2YV0HCEtkS4hHW3SA9J3JCSN4TukpxHl/PrXSR1ST5eVSVOkGQzCRHKX9AwJSGKYw2eZdD1U/pK0QnoryipavhZTIzVIV0P1n5NukX7DAVfDbPYVaU6UvSM9hOpVhMyuRTzjMcmD6u1F0jnx22vSZTiYdh3WlkNmW6TzEWZtNElbpAu6bkv8NqfbiMWlh8Mx6xJ3nr7OQvV4FFXS8aTPjjPMo8E3kedeeYTkePraDJWz6bOkBVF2FJbRYzfs8Gs6ptMcszeRDl+LO6giyq9B/TEHMBjHD0J9L5HYepgnhU8ifxrJYtZEBcMfpU+6T/ooyk7BMLnYPrp5keahKwuzjA8VCgEV0l7dRlTbQ9gM10V6BdniQw1zAc1QG3VTRVNIcDz90GmewfYjH7ZEmnudx+NgRjyMiAWTqYenRTppKHikP1pezL3VUH7d4KGPyfCESHfgjgf1ektaTdhN+1ChUdXpjsFDH5NhuVDpwZ0FxzKJh8F6o2fw0Oe/2SJtinQZ7rQcy0yUDR76mHYcXZGegjuevgZh0EL8hwdDW92oG3Z6WAvzCymHtQ1xMz+ghvypYWBWtj+E7aNbFekG8qdhaHuInVj8RMG7kG0vfrhCW+QXkR/y2W1YjgHi1sNfSLd1elLfv4ZseUK6IfIXYZms4gxzRR4lgo9uVuc/IBt4+7Uk8jyVt20V4gwzbO4Q6YTO15BNT3PPSrO83b8XV8nFMPMGavUUbJe4p89A7fd+Ihkz2pwMg/ekK6S/cZXzOkiJYqQHKZLCHFVJCnUYKCnMcWsUIznQztLwSBj/UyZvxobz5h8AAAD//6o4IfsAAAAGSURBVAMAJS2e0Q8NpAcAAAAASUVORK5CYII="

function createTrayIcon() {
  const raw = nativeImage.createFromBuffer(Buffer.from(trayIconBase64, "base64"), { scaleFactor: 2.0 })
  const icon = raw.resize({ width: 22, height: 22 })
  icon.setTemplateImage(true)
  return icon
}

function importNewEvents() {
  if (!state.store || !state.paths) return false

  const previousOffset = state.jsonlOffset
  const result = readJsonlEvents(state.paths.jsonlPath, state.jsonlOffset)
  const nextOffset = result.nextOffset
  state.importErrors += result.errors
  if (result.events.length > 0) {
    state.store.insertEvents(result.events)
    broadcastDashboardUpdated()
  }
  state.jsonlOffset = nextOffset
  if (nextOffset > previousOffset) {
    compactJsonlFile(state.paths.jsonlPath, nextOffset)
    state.jsonlOffset = 0
  }
  writeImportState()
  updateTrayTitle()

  return result.events.length > 0
}

function insertLocalMetric(event: MetricEvent) {
  state.eventBuffer?.push(event)
}

function watchMetricEvents() {
  if (!state.paths) return

  void state.watcher?.close()
  mkdirSync(dirname(state.paths.jsonlPath), { recursive: true })
  state.watcher = chokidar.watch(state.paths.jsonlPath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
  })
  state.watcher.on("add", importNewEvents)
  state.watcher.on("change", importNewEvents)
}

function createWindow() {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  state.window = new BrowserWindow({
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

  state.window.on("blur", () => {
    setTimeout(() => {
      if (state.window?.isVisible() && !state.window.isFocused()) {
        state.window.hide()
      }
    }, 150)
  })

  if (rendererUrl) {
    void state.window.loadURL(rendererUrl)
  } else {
    void state.window.loadFile(path.join(app.getAppPath(), "dist/renderer/index.html"))
  }
}

function showWindowNearTray() {
  if (!state.window || !state.tray) return
  if (state.window.isVisible()) return

  const trayBounds = state.tray.getBounds()
  const windowBounds = state.window.getBounds()
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

  state.window.setPosition(nextX, nextY, false)
  state.window.show()
}

function toggleWindow() {
  if (!state.window || !state.tray) return
  if (state.window.isVisible()) {
    state.window.hide()
    return
  }
  showWindowNearTray()
}

if (process.platform === "darwin") {
  app.setActivationPolicy("accessory")
}

app.whenReady().then(async () => {
  if (process.env.ELECTRON_RENDERER_URL) {
    app.setName("opencode-token-menubar-dev")
  }

  if (process.platform === "darwin") {
    app.dock?.hide()
  }

  const userDataPath = app.getPath("userData")
  state.paths = resolveAppPaths(app.getAppPath(), userDataPath)
  state.importStatePath = path.join(userDataPath, "import-state.json")
  const importState = readImportState(state.importStatePath)
  state.jsonlOffset = importState.jsonlOffset
  state.importErrors = importState.importErrors
  state.store = new MetricsStore(state.paths.sqlitePath)
  state.eventBuffer = new EventBuffer({
    flushMs: 200,
    onFlush: (events) => {
      if (!state.store) return
      state.store.insertEvents(events)
      updateTrayTitle()
      broadcastDashboardUpdated()
    },
  })
  syncModelCatalog()
  try {
    state.ingestServer = await startIngestServer({
      ingestPath: state.paths.ingestPath,
      onMetric: insertLocalMetric,
    })
  } catch (error) {
    console.warn("Failed to start ingest server", error)
  }
  importNewEvents()
  watchMetricEvents()

  // 远程桥接：非阻塞启动（不卡 UI），有效配置才启动
  void (async () => {
    if (!state.paths) return
    const bridgeConfigPath = process.env.BRIDGE_CONFIG_PATH ?? state.paths.bridgeConfigPath
    const bridgeCfg = readBridgeConfig(bridgeConfigPath)
    if (!bridgeCfg) return
    try {
      const tgAdapter = new TelegramAdapter({
        botToken: bridgeCfg.telegram.botToken,
        throttleMs: bridgeCfg.throttleMs,
        // 代理优先级：配置文件 > HTTPS_PROXY 环境变量
        ...(bridgeCfg.proxy ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY
          ? { proxy: bridgeCfg.proxy ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY }
          : {}),
      })
      await tgAdapter.verifyToken()
      await tgAdapter.registerCommands()

      // baseUrl 未指定时自动探测运行中的 OpenCode 实例
      let baseUrl: string = bridgeCfg.opencode.baseUrl ?? ""
      let password = bridgeCfg.opencode.password
      if (!baseUrl) {
        const discovered = await discoverOpenCode()
        if (discovered) {
          baseUrl = discovered.url
          password = discovered.password ?? password
        } else {
          baseUrl = "http://localhost:4096"
        }
      }

      const proxy = OpenCodeProxy.fromBaseUrl(baseUrl, password)
      state.bridge = new Bridge(tgAdapter, proxy, {
        allowlist: bridgeCfg.allowlist,
        autoApprove: bridgeCfg.autoApprove,
      })
      await state.bridge.start()
      console.log("Bridge started")
    } catch (error) {
      console.warn("Failed to start bridge", error)
      state.bridge = null
    }
  })()

  ipcMain.handle("metrics:get-dashboard-data", (_event, filters: unknown) => {
    return getDashboardData(normalizeDashboardFilters(filters))
  })
  ipcMain.handle("metrics:get-summary", (_event, filters: unknown) => {
    return getSummaryData(normalizeDashboardFilters(filters))
  })
  ipcMain.handle("metrics:get-recent", (_event, filters: unknown) => {
    if (!state.store) throw new Error("Metrics store is not initialized")
    return state.store.getRecent(normalizeDashboardFilters(filters))
  })
  ipcMain.handle("metrics:get-ranking", (_event, filters: unknown) => {
    if (!state.store) throw new Error("Metrics store is not initialized")
    return state.store.getRanking(normalizeDashboardFilters(filters))
  })
  ipcMain.handle("metrics:get-trends", (_event, filters: unknown) => {
    if (!state.store) throw new Error("Metrics store is not initialized")
    return state.store.getTrends(normalizeDashboardFilters(filters))
  })
  ipcMain.handle("plugin:install", () => installGlobalPlugin())
  ipcMain.handle("theme:set-source", (_event, source: unknown) => {
    if (source === "dark" || source === "light" || source === "system") {
      nativeTheme.themeSource = source
    }
  })
  ipcMain.handle("bridge:status", () => ({ running: state.bridge != null }))

  createWindow()
  state.tray = new Tray(createTrayIcon())
  state.tray.setToolTip("OpenCode Token Menubar")
  state.tray.on("click", toggleWindow)
  state.tray.on("right-click", () => state.tray?.popUpContextMenu(buildTrayMenu()))
  updateTrayTitle()

  setTimeout(toggleWindow, 300)
})

app.on("activate", () => {
  showWindowNearTray()
})

app.on("window-all-closed", () => {
})

app.on("before-quit", (event) => {
  if (state.isShuttingDown) return

  event.preventDefault()
  state.isShuttingDown = true

  void (async () => {
    try {
      try {
        await state.watcher?.close()
      } catch (error) {
        console.warn("Failed to close metrics watcher", error)
      } finally {
        state.watcher = null
      }

      try {
        await state.ingestServer?.stop()
      } catch (error) {
        console.warn("Failed to stop ingest server", error)
      } finally {
        state.ingestServer = null
      }

      try {
        await state.bridge?.stop()
      } catch (error) {
        console.warn("Failed to stop bridge", error)
      } finally {
        state.bridge = null
      }

      state.eventBuffer?.flush()
      state.eventBuffer = null

      try {
        state.store?.close()
      } catch (error) {
        console.warn("Failed to close metrics store", error)
      } finally {
        state.store = null
      }
    } finally {
      app.quit()
    }
  })()
})
