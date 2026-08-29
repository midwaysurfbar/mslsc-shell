const { app, BaseWindow, WebContentsView, ipcMain, Menu, Tray, nativeImage, shell, dialog, session, desktopCapturer, webContents } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('node:path')
const fs = require('node:fs')

// A desktop window that loads the live MSLSC systems inside their own
// view, switched via a rail on the left, instead of a dozen browser
// tabs. Every system's real, already-deployed URL is used as-is -
// nothing about the systems themselves changes.
//
// The home screen embeds the real MSLSC Hub page (renderer/index.html's
// <webview>) as the actual system launcher, rather than a second
// hand-maintained copy of its card grid - the Hub is the one source of
// truth for "every MSLSC system" now. See HUB_URL / the
// register-hub-webcontents handler below.

const RAIL_WIDTH = 64
// The home screen's <webview> loads this - the Hub is the actual source
// of truth for "every MSLSC system" now, not this file's SYSTEMS map.
const HUB_URL = 'https://midwaysurfhub.vercel.app/'
const HUB_ORIGIN = new URL(HUB_URL).origin

// Every page the rail's own quick-launch icons open, keyed by a short id.
// This is NOT the source of truth for "every MSLSC system" any more - the
// home screen embeds the real, live Hub page (renderer/index.html), which
// is where a newly-built app actually needs adding (its own systemsFor()
// in MSLSC Hub/src/App.jsx) to show up here with zero changes to this
// file. This map only needs new entries for a system that should ALSO
// get its own rail shortcut - a nice-to-have, not a requirement.
// showSystem() below accepts a raw URL too (not just a key from this
// map) - that's how a link clicked inside the embedded Hub page opens.
const SYSTEMS = {
  attendance: { label: 'Attendance Admin', url: 'https://midwaysurfregister.vercel.app/admin' },
  'attendance-kiosk': { label: 'Sign-In Kiosk', url: 'https://midwaysurfregister.vercel.app/' },
  'attendance-dashboard': { label: 'Dashboard', url: 'https://midwaysurfregister.vercel.app/dashboard' },
  'attendance-barnotes': { label: 'Bar Notes', url: 'https://midwaysurfregister.vercel.app/bar-notes' },
  'attendance-dutysummary': { label: 'Duty Summary', url: 'https://midwaysurfregister.vercel.app/duty-summary' },
  'attendance-mobilemembers': { label: 'Mobile Members', url: 'https://midwaysurfregister.vercel.app/mobile-members' },

  barmenu: { label: 'Bar Menu Admin', url: 'https://midwaysurfbarmenu.vercel.app/admin' },
  'barmenu-board': { label: 'Menu Board', url: 'https://midwaysurfbarmenu.vercel.app/' },

  barinventory: { label: 'Bar Inventory', url: 'https://midwaysurfbarinventory.vercel.app/' },

  barbooking: { label: 'Bar Booking Admin', url: 'https://midwaysurfbarbookings.vercel.app/admin' },
  'barbooking-login': { label: 'Open / Login', url: 'https://midwaysurfbarbookings.vercel.app/' },
  'barbooking-calendar': { label: 'Calendar', url: 'https://midwaysurfbarbookings.vercel.app/calendar' },
  'barbooking-approvals': { label: 'Approvals', url: 'https://midwaysurfbarbookings.vercel.app/approvals' },

  nippers: { label: 'Nippers Check-In', url: 'https://midwaysurfnippers.vercel.app/checkin' },
  'nippers-checkout': { label: 'Nippers Check-Out', url: 'https://midwaysurfnippers.vercel.app/checkout' },
  'nippers-children': { label: 'Children', url: 'https://midwaysurfnippers.vercel.app/children' },
  'nippers-agegroups': { label: 'Age Groups', url: 'https://midwaysurfnippers.vercel.app/age-groups' },
  'nippers-report': { label: 'Nippers Report', url: 'https://midwaysurfnippers.vercel.app/report' },

  foodcost: { label: 'Food Cost Builder', url: 'https://midwaysurffoodcost.vercel.app/' },

  auction: { label: 'Auction Admin', url: 'https://midwaysurfauction.vercel.app/admin' },
  'auction-board': { label: 'Board', url: 'https://midwaysurfauction.vercel.app/board' },

  raffle: { label: 'Raffle Admin', url: 'https://midwaysurfraffle.vercel.app/admin' },
  'raffle-board': { label: 'Board', url: 'https://midwaysurfraffle.vercel.app/board' },
  'raffle-fundraiser': { label: 'Fundraiser', url: 'https://midwaysurfraffle.vercel.app/fundraiser' },

  eventpos: { label: 'Event POS', url: 'https://midwaysurfeventpos.vercel.app/' },
  'eventpos-report': { label: 'Report', url: 'https://midwaysurfeventpos.vercel.app/report' },
  'eventpos-history': { label: 'History', url: 'https://midwaysurfeventpos.vercel.app/history' },
  'eventpos-float': { label: 'Cash Float', url: 'https://midwaysurfeventpos.vercel.app/float' },

  preorder: { label: 'Meal Pre-Order', url: 'https://midwaysurfpreorder.vercel.app/' },
  'preorder-admin': { label: 'Admin', url: 'https://midwaysurfpreorder.vercel.app/admin' },
}

// The Video Jukebox is its own installed desktop app (local video
// library + a fullscreen deck for the TV), not a website - so its rail
// button launches that app rather than loading a URL in-window.
const EXTERNAL_APPS = {
  jukebox: { label: 'Video Jukebox' },
}

function launchJukebox() {
  const candidates = []
  if (process.platform === 'win32') {
    const lad = process.env.LOCALAPPDATA || ''
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const pd = process.env.ProgramData || 'C:\\ProgramData'
    const ad = process.env.APPDATA || ''
    candidates.push(
      path.join(lad, 'Programs', 'MSLSC Jukebox', 'MSLSC Jukebox.exe'),
      path.join(pf, 'MSLSC Jukebox', 'MSLSC Jukebox.exe'),
      path.join(pfx, 'MSLSC Jukebox', 'MSLSC Jukebox.exe'),
      path.join(pd, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'MSLSC Jukebox.lnk'),
      path.join(ad, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'MSLSC Jukebox.lnk'),
    )
  } else {
    const home = app.getPath('home')
    candidates.push(
      path.join(home, 'Applications', 'MSLSC Jukebox.AppImage'),
      path.join(home, 'Applications', 'MSLSC-Jukebox.AppImage'),
      path.join(home, 'Downloads', 'MSLSC Jukebox.AppImage'),
    )
  }

  const found = candidates.find((p) => {
    try { return fs.existsSync(p) } catch { return false }
  })

  if (found) {
    shell.openPath(found).then((err) => {
      if (err) dialog.showErrorBox('Video Jukebox', `Couldn't launch the Jukebox app:\n${err}`)
    })
  } else {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Video Jukebox',
      message: "The Video Jukebox app isn't installed on this PC yet.",
      detail: 'Install it from the mslsc-jukebox GitHub releases and this button will launch it.',
    })
  }
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

function labelForUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'that page' }
}

// `idOrUrl` is either one of SYSTEMS' short ids (rail icons, the old
// hand-maintained list) or a raw URL - the latter is how a link clicked
// inside the embedded Hub page on the home screen gets opened, so a new
// app added to the Hub just works here with zero edits to this file.
// Either way it's used as-is as the systemViews cache key, so revisiting
// the same URL twice still gets the instant-switch caching benefit.
function showSystem(idOrUrl, adhocLabel) {
  const known = SYSTEMS[idOrUrl]
  const key = idOrUrl
  const url = known ? known.url : idOrUrl
  const label = known ? known.label : (adhocLabel || labelForUrl(idOrUrl))

  activeSystemId = key
  // Only a known short id is safe to silently reopen on next launch -
  // an ad-hoc URL's label wouldn't survive a restart, so it'd show a
  // loading spinner with no context if restored blind.
  if (known) saveState({ lastSystemId: key })

  if (loadedSystemIds.has(key)) {
    // Already loaded before - switch instantly, no loading state.
    revealSystemView(key, systemViews.get(key))
    return
  }

  // First time opening this system: keep homeView covering the full pane
  // showing a loading state, and only reveal the real view once it's
  // actually ready - avoids a blank white flash while the real page loads.
  homeView.setBounds({ x: 0, y: 0, ...mainWindowFullSize() })
  homeView.webContents.send('loading-state', { show: true, label })

  let view = systemViews.get(key)
  if (!view) {
    view = new WebContentsView({
      webPreferences: { contextIsolation: true, sandbox: true },
    })
    mainWindow.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    systemViews.set(key, view)

    view.webContents.on('did-finish-load', () => {
      loadedSystemIds.add(key)
      revealSystemView(key, view)
    })

    view.webContents.on('did-fail-load', (_event, errorCode) => {
      if (errorCode === -3) return // ERR_ABORTED - a normal in-page navigation, not a real failure
      if (activeSystemId !== key) return
      homeView.webContents.send('loading-state', { show: true, label, error: true })
    })
  }

  view.webContents.loadURL(url)
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
      // The home screen embeds the live Hub page (see renderer/index.html)
      // instead of hand-duplicating its system list - webviewTag needs
      // sandbox:false, already set above for the audio-loopback capture.
      webviewTag: true,
    },
  })
  mainWindow.contentView.addChildView(homeView)
  homeView.webContents.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  homeView.setBounds({ x: 0, y: 0, ...mainWindowFullSize() })
  if (process.env.MSLSC_DEBUG) {
    homeView.webContents.openDevTools({ mode: 'detach' })
    homeView.webContents.on('did-fail-load', (_e, code, desc) => console.log('DID-FAIL-LOAD', code, desc))
    homeView.webContents.on('console-message', (_e, level, message) => console.log('RENDERER-CONSOLE', level, message))
  }

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
    if (EXTERNAL_APPS[id]) { if (id === 'jukebox') launchJukebox(); return }
    if (id === 'home') showHome()
    else showSystem(id)
  })

  // A link clicked inside the embedded Hub page on the home screen -
  // see the will-navigate handler in renderer/index.html.
  ipcMain.on('open-url', (_event, url, label) => showSystem(url, label))

  // The <webview>'s OWN will-navigate (fired on its DOM element) can't
  // be cancelled - Electron only honours preventDefault() on a real
  // WebContents' will-navigate. So the renderer hands over the guest's
  // webContents id once it's ready, and this hooks the real event here:
  // any link to a different origin opens as a proper system view in
  // this window instead of navigating the little embedded Hub away.
  ipcMain.on('register-hub-webcontents', (_event, id) => {
    const guest = webContents.fromId(id)
    if (!guest) return
    guest.on('will-navigate', (navEvent, url) => {
      let origin = null
      try { origin = new URL(url).origin } catch { return }
      if (origin === HUB_ORIGIN) return
      navEvent.preventDefault()
      showSystem(url)
    })
  })

  ipcMain.on('retry-system', (_event, id) => {
    const known = SYSTEMS[id]
    const view = systemViews.get(id)
    if (!view || activeSystemId !== id) return
    const url = known ? known.url : id
    const label = known ? known.label : labelForUrl(id)
    homeView.webContents.send('loading-state', { show: true, label })
    view.webContents.loadURL(url)
  })
}

let updateReady = false

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon-hub-tray.png'))
  tray = new Tray(icon)
  tray.setToolTip('MSLSC')
  refreshTrayMenu()
  tray.on('click', () => {
    if (mainWindow.isVisible()) mainWindow.hide()
    else { mainWindow.show(); mainWindow.focus() }
  })
}

/** Rebuilds the tray context menu - called at startup, and again once an
 * update has finished downloading so a "Restart to Update" item appears. */
function refreshTrayMenu() {
  if (!tray) return
  const items = [
    { label: 'Open MSLSC', click: () => { mainWindow.show(); mainWindow.focus() } },
  ]
  if (updateReady) {
    items.push({ type: 'separator' })
    items.push({ label: 'Restart to Update', click: () => autoUpdater.quitAndInstall() })
  }
  items.push({ type: 'separator' })
  items.push({ label: 'Quit', click: () => app.quit() })
  tray.setContextMenu(Menu.buildFromTemplate(items))
  tray.setToolTip(updateReady ? 'MSLSC - update ready, restart to apply' : 'MSLSC')
}

// --- Auto-update: checks GitHub Releases (midwaysurfbar/mslsc-shell),
// downloads silently in the background, and installs automatically the
// next time the app actually quits (tray -> Quit, or a machine reboot) -
// no one needs to hunt down a fresh installer from GitHub by hand again.
// Only runs against the real packaged app (`npm start` dev mode has no
// update feed bundled in, and would just log a harmless "not packaged"
// error if this ran unguarded).
function setupAutoUpdate() {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  if (process.env.MSLSC_DEBUG) {
    autoUpdater.logger = console
  }

  autoUpdater.on('update-downloaded', () => {
    updateReady = true
    refreshTrayMenu()
  })
  autoUpdater.on('error', (err) => {
    if (process.env.MSLSC_DEBUG) console.log('AUTO-UPDATE ERROR', err)
  })

  autoUpdater.checkForUpdates()
  // The app is designed to live in the tray for days at a time rather
  // than being relaunched daily, so a startup-only check isn't enough -
  // check periodically too.
  setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000)
}

// The home screen's audio EQ captures the PC's audio output mix. Grant
// getDisplayMedia({audio:true}) with loopback audio and no picker - the
// renderer only ever uses the audio track (the screen video track is
// stopped immediately).
function setupAudioLoopback() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => {
        try { callback({ video: sources[0], audio: 'loopback' }) }
        catch { try { callback({}) } catch { /* renderer went away */ } }
      })
      .catch(() => { try { callback({}) } catch { /* noop */ } })
  }, { useSystemPicker: false })
}

app.whenReady().then(() => {
  // No end user needs File/Edit/View/Window/Help on a kiosk-style app -
  // real menu/keyboard-shortcut design is a later phase, this just
  // removes Electron's default dev menu for a cleaner first look.
  Menu.setApplicationMenu(null)
  setupAudioLoopback()
  createWindow()
  createTray()
  setupAutoUpdate()
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
