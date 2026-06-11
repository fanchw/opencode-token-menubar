import { app, BrowserWindow, ipcMain, nativeImage, screen, Tray } from "electron"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path, { dirname } from "node:path"
import chokidar, { type FSWatcher } from "chokidar"

import { readJsonlEvents } from "./jsonlImporter.js"
import { MetricsStore } from "./metricsStore.js"
import { resolveAppPaths, type AppPaths } from "./paths.js"
import { installPlugin } from "./pluginInstaller.js"
import type { DashboardData } from "../shared/metrics.js"

let tray: Tray | null = null
let window: BrowserWindow | null = null
let store: MetricsStore | null = null
let watcher: FSWatcher | null = null
let paths: AppPaths | null = null
let importStatePath: string | null = null
let jsonlOffset = 0
let importErrors = 0

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

function getDashboardData(): DashboardData {
  if (!store || !paths) {
    throw new Error("Metrics store is not initialized")
  }

  const data = store.getDashboardData({ ...getTodayRange(), recentLimit: 20 })

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
    tray.setTitle(`${Math.round(recentSpeed)} tok/s`)
  } else if (data.today.totalTokens > 0) {
    tray.setTitle(`${Math.round(data.today.totalTokens / 100) / 10}K tok`)
  } else {
    tray.setTitle("OpenCode")
  }
}

function importNewEvents() {
  if (!store || !paths) return

  const result = readJsonlEvents(paths.jsonlPath, jsonlOffset)
  jsonlOffset = result.nextOffset
  importErrors += result.errors
  if (result.events.length > 0) {
    store.insertEvents(result.events)
  }
  writeImportState()
  updateTrayTitle()
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
  window = new BrowserWindow({
    width: 520,
    height: 680,
    show: false,
    frame: false,
    resizable: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist/main/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
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

app.whenReady().then(() => {
  const userDataPath = app.getPath("userData")
  paths = resolveAppPaths(app.getAppPath(), userDataPath)
  importStatePath = path.join(userDataPath, "import-state.json")
  const importState = readImportState(importStatePath)
  jsonlOffset = importState.jsonlOffset
  importErrors = importState.importErrors
  store = new MetricsStore(paths.sqlitePath)
  importNewEvents()
  watchMetricEvents()

  ipcMain.handle("metrics:get-dashboard-data", () => getDashboardData())
  ipcMain.handle("plugin:install", async () => {
    if (!paths) {
      throw new Error("App paths are not initialized")
    }

    return installPlugin({
      sourcePath: paths.bundledPluginPath,
      targetPath: paths.pluginPath,
    })
  })

  createWindow()
  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip("OpenCode Token Menubar")
  tray.on("click", toggleWindow)
  updateTrayTitle()
})

app.on("window-all-closed", () => {
})

app.on("before-quit", () => {
  void watcher?.close()
  watcher = null
  store?.close()
  store = null
})
