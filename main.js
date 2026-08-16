const { app, BaseWindow, WebContentsView, ipcMain, Menu, Tray, nativeImage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

// Phase 1 local prototype (see the "MSLSC Systems Shell" scoping note) -
// a desktop window that loads the six live MSLSC systems inside their
// own view, switched via a rail on the left, instead of six separate
// browser tabs. Every system's real, already-deployed URL is used as-is
// - nothing about the six systems themselves changes.

const RAIL_WIDTH = 64

const SYSTEMS = {
  attendance: { label: 'Attendance', url: 'https://midwaysurfregister.vercel.app/' },
  barmenu: { label: 'Bar Menu', url: 'https://midwaysurfbarmenu.vercel.app/' },
  barinventory: { label: 'Bar Inventory', url: 'https://midwaysurfbarinventory.vercel.app/' },
  barbooking: { label: 'Bar Booking', url: 'https://midwaysurfbarbookings.vercel.app/' },
  auction: { label: 'Auction', url: 'https://midwaysurfauction.vercel.app/' },
  raffle: { label: 'Raffle', url: 'https://midwaysurfraffle.vercel.app/' },
}

let mainWindow = null
let homeView = null
let tray = null
let isQuitting = false
/** @type {Map<string, WebContentsView>} */
const systemViews = new Map()
/** Ids that have finished loading at least once - switching back to one of
 * these is instant, no loading state needed. */
const loadedSystemIds = new Set()
let activeSystemId = 'home'

// --- Small persisted state: window bounds + which system was last open,
// so relaunching feels like reopening the same app, not starting fresh. ---
const STATE_PATH = path.join(app.getPath('userData'), 'window-state.json')

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveState(partial) {
  try {
    const next = { ...loadState(), ...partial }
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
    fs.writeFileSync(STATE_PATH, JSON.stringify(next))
  } catch {
    // Losing window-state memory once isn't worth crashing the app over.
  }
}

let saveBoundsTimer = null
function scheduleSaveBounds() {
  clearTimeout(saveBoundsTimer)
  saveBoundsTimer = setTimeout(() => {
    if (mainWindow) saveState({ bounds: mainWindow.getBounds() })
  }, 400)
}

function contentBounds() {
  const [width, height] = mainWindow.getContentSize()
  return { x: RAIL_WIDTH, y: 0, width: Math.max(0, width - RAIL_WIDTH), height }
}

function layoutActiveView() {
  if (activeSystemId === 'home') return
  const view = systemViews.get(activeSystemId)
  if (view) view.setBounds(contentBounds())
}

function showHome() {
  activeSystemId = 'home'
  saveState({ lastSystemId: 'home' })
  homeView.webContents.send('loading-state', { show: false })
  for (const view of systemViews.values()) view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  homeView.setBounds({ x: 0, y: 0, ...mainWindowFullSize() })
}

function mainWindowFullSize() {
  const [width, height] = mainWindow.getContentSize()
  return { width, height }
}

/** Shows a view at full content bounds, hiding every other system view and
 * shrinking homeView down to just the rail. */
function revealSystemView(id, view) {
  if (activeSystemId !== id) return // user navigated elsewhere while this was loading
  homeView.webContents.send('loading-state', { show: false })
  homeView.setBounds({ x: 0, y: 0, width: RAIL_WIDTH, height: mainWindowFullSize().height })
  for (const [otherId, otherView] of systemViews) {
    if (otherId !== id) otherView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  }
  view.setBounds(contentBounds())
}

function showSystem(id) {
  const system = SYSTEMS[id]
  if (!system) return

  activeSystemId = id
  saveState({ lastSystemId: id })

  if (loadedSystemIds.has(id)) {
    // Already loaded before - switch instantly, no loading state.
    revealSystemView(id, systemViews.get(id))
    return
  }

  // First time opening this system: keep homeView covering the full pane
  // showing a loading state, and only reveal the real view once it's
  // actually ready - avoids a blank white flash while the real page loads.
  homeView.setBounds({ x: 0, y: 0, ...mainWindowFullSize() })
  homeView.webContents.send('loading-state', { show: true, label: system.label })

  let view = systemViews.get(id)
  if (!view) {
    view = new WebContentsView({
      webPreferences: { contextIsolation: true, sandbox: true },
    })
    mainWindow.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    systemViews.set(id, view)

    view.webContents.on('did-finish-load', () => {
      loadedSystemIds.add(id)
      revealSystemView(id, view)
    })

    view.webContents.on('did-fail-load', (_event, errorCode) => {
      if (errorCode === -3) return // ERR_ABORTED - a normal in-page navigation, not a real failure
      if (activeSystemId !== id) return
      homeView.webContents.send('loading-state', { show: true, label: system.label, error: true })
    })
  }

  view.webContents.loadURL(system.url)
}

function createWindow() {
  const state = loadState()
  const bounds = state.bounds || { width: 1280, height: 820 }

  mainWindow = new BaseWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#173F4F',
    title: 'MSLSC',
    icon: path.join(__dirname, 'assets', 'icon-hub-256.png'),
  })

  homeView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  })
  mainWindow.contentView.addChildView(homeView)
  homeView.webContents.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  homeView.setBounds({ x: 0, y: 0, ...mainWindowFullSize() })

  // Reopen to whichever system was open last, instead of always landing
  // on Home - only once the renderer's own listeners are ready.
  homeView.webContents.once('did-finish-load', () => {
    const lastId = state.lastSystemId
    if (lastId && lastId !== 'home' && SYSTEMS[lastId]) {
      homeView.webContents.send('restore-rail-highlight', lastId)
      showSystem(lastId)
    }
  })

  mainWindow.on('resize', () => {
    if (activeSystemId === 'home') {
      homeView.setBounds({ x: 0, y: 0, ...mainWindowFullSize() })
    } else {
      homeView.setBounds({ x: 0, y: 0, width: RAIL_WIDTH, height: mainWindowFullSize().height })
      layoutActiveView()
    }
    scheduleSaveBounds()
  })
  mainWindow.on('move', scheduleSaveBounds)

  // Closing the window (the [x] button) minimises to the tray instead of
  // quitting outright - this app is meant to live in the background all
  // day on a venue PC, not be relaunched every time someone clicks away
  // from it. The tray menu's "Quit" is the real way out.
  mainWindow.on('close', (event) => {
    if (isQuitting) {
      saveState({ bounds: mainWindow.getBounds() })
      return
    }
    event.preventDefault()
    mainWindow.hide()
  })

  ipcMain.on('select-system', (_event, id) => {
    if (id === 'home') showHome()
    else showSystem(id)
  })

  ipcMain.on('retry-system', (_event, id) => {
    const system = SYSTEMS[id]
    const view = systemViews.get(id)
    if (!system || !view || activeSystemId !== id) return
    homeView.webContents.send('loading-state', { show: true, label: system.label })
    view.webContents.loadURL(system.url)
  })
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon-hub-tray.png'))
  tray = new Tray(icon)
  tray.setToolTip('MSLSC')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open MSLSC', click: () => { mainWindow.show(); mainWindow.focus() } },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
  tray.on('click', () => {
    if (mainWindow.isVisible()) mainWindow.hide()
    else { mainWindow.show(); mainWindow.focus() }
  })
}

app.whenReady().then(() => {
  // No end user needs File/Edit/View/Window/Help on a kiosk-style app -
  // real menu/keyboard-shortcut design is a later phase, this just
  // removes Electron's default dev menu for a cleaner first look.
  Menu.setApplicationMenu(null)
  createWindow()
  createTray()
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
