import { app, BrowserWindow, nativeImage, Tray } from "electron"
import path from "node:path"

let tray: Tray | null = null
let window: BrowserWindow | null = null

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
  window.setPosition(
    Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2),
    Math.round(trayBounds.y + trayBounds.height + 6),
    false,
  )
  window.show()
}

app.whenReady().then(() => {
  createWindow()
  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip("OpenCode Token Menubar")
  tray.setTitle("OpenCode")
  tray.on("click", toggleWindow)
})

app.on("window-all-closed", () => {
})
