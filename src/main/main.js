const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Library } = require('./library');
const { Launcher } = require('./launcher');
const { fetchArt, steamSearch } = require('./metadata');

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let win;
let library;
const launcher = new Launcher();

const send = (channel, ...args) => win && !win.isDestroyed() && win.webContents.send(channel, ...args);

// Last window size/position; opens maximized by default.
function savedWindowState() {
  const ws = library.settings.window || { maximized: true };
  const b = ws.bounds;
  const onScreen =
    b &&
    screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
  return { maximized: ws.maximized !== false, bounds: onScreen ? b : { width: 1440, height: 900 } };
}

function createWindow() {
  const ws = savedWindowState();
  win = new BrowserWindow({
    ...ws.bounds,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    backgroundColor: '#07080c',
    show: false,
    title: 'Shallow',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => (ws.maximized ? win.maximize() : win.show()));
  win.on('close', () => {
    // Full screen (mode manette) is not a window state to restore: reopen maximized instead.
    library.updateSettings({ window: { maximized: win.isMaximized() || win.isFullScreen(), bounds: win.getNormalBounds() } });
    library.saveNow();
  });
  win.on('maximize', () => send('window:state', true));
  win.on('unmaximize', () => send('window:state', false));

  // Dev helper: `electron . --screenshot=out.png` saves a capture once the UI settled.
  const shot = process.argv.find((a) => a.startsWith('--screenshot='));
  if (shot) {
    win.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        const script = process.argv.find((a) => a.startsWith('--eval='));
        if (script) {
          await win.webContents.executeJavaScript(script.slice(7)).catch(() => {});
          await new Promise((r) => setTimeout(r, 1500));
        }
        const img = await win.webContents.capturePage();
        fs.writeFileSync(shot.split('=')[1], img.toPNG());
        if (!process.argv.includes('--keep-open')) app.quit();
      }, Number((process.argv.find((a) => a.startsWith('--delay=')) || '=6000').split('=')[1]))
    );
  }
}

// --- Art downloading queue ------------------------------------------------

const artQueue = [];
let artActive = 0;

function queueArt(id, opts = {}, front = false) {
  if (artQueue.some((j) => j.id === id)) return;
  front ? artQueue.unshift({ id, opts }) : artQueue.push({ id, opts });
  pumpArt();
}

function pumpArt() {
  while (artActive < 3 && artQueue.length) {
    const { id, opts: queued } = artQueue.shift();
    const g = library.get(id);
    if (!g) continue;
    // Steam games know their exact app: no need to guess from the name.
    const opts = !queued.appid && g.source === 'steam' ? { ...queued, appid: g.steamAppId, steamName: g.name } : queued;
    artActive++;
    send('art:progress', { id, pending: artQueue.length + artActive });
    fetchArt(g.name, g.id, library.artDir, opts)
      .then((art) => {
        const patch = { artFetched: true, ...(art || {}) };
        // Keep pictures the user picked by hand unless they explicitly asked for new ones.
        if (!opts.force && g.custom && g.custom.cover) delete patch.cover;
        if (!opts.force && g.custom && g.custom.hero) delete patch.hero;
        if (opts.force) g.custom = { ...g.custom, cover: false, hero: false };
        const updated = library.update(id, patch);
        send('game:updated', decorate(updated));
      })
      .catch(() => library.update(id, { artFetched: true }))
      .finally(() => {
        artActive--;
        send('art:progress', { id, pending: artQueue.length + artActive });
        pumpArt();
      });
  }
}

function decorate(g) {
  return g && { ...g, running: launcher.isRunning(g.id) };
}

function allGames() {
  return library.list().map(decorate);
}

function rescan() {
  library.rescan();
  for (const g of library.list()) if (!g.artFetched) queueArt(g.id);
  return allGames();
}

// --- IPC ------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('library:get', () => ({ games: allGames(), settings: library.settings, sessions: library.sessions }));
  ipcMain.handle('session:update', (_e, id, patch) => library.updateSession(id, patch));
  ipcMain.handle('library:rescan', () => rescan());
  ipcMain.handle('game:update', (_e, id, patch) => decorate(library.update(id, patch)));

  ipcMain.handle('game:launch', (_e, id) => {
    const g = library.get(id);
    if (!g) return { ok: false, error: 'Jeu introuvable' };
    const viaStore = g.launchUri && !(g.custom && g.custom.exe);
    if (!viaStore && !fs.existsSync(g.exe)) return { ok: false, error: `Exécutable introuvable :\n${g.exe}` };
    const res = launcher.launch(g);
    library.update(id, { lastPlayed: Date.now() });
    if (library.settings.minimizeOnLaunch && !res.already) setTimeout(() => win && win.minimize(), 1200);
    return res;
  });
  ipcMain.handle('game:stop', (_e, id) => launcher.stop(id));
  ipcMain.handle('game:openFolder', (_e, id) => {
    const g = library.get(id);
    if (g) g.exe && fs.existsSync(g.exe) ? shell.showItemInFolder(g.exe) : shell.openPath(g.folder);
  });
  ipcMain.handle('game:refetchArt', (_e, id, opts) => queueArt(id, { ...opts, force: true }, true));

  ipcMain.handle('game:pickImage', async (_e, id, kind) => {
    const res = await dialog.showOpenDialog(win, {
      title: kind === 'hero' ? "Choisir l'image de fond" : 'Choisir une cover',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    fs.mkdirSync(library.artDir, { recursive: true });
    const src = res.filePaths[0];
    const dest = path.join(library.artDir, `custom-${id}-${kind}-${Date.now()}${path.extname(src)}`);
    fs.copyFileSync(src, dest);
    const g = library.get(id);
    return decorate(library.update(id, { [kind]: dest, custom: { ...g.custom, [kind]: true } }));
  });

  ipcMain.handle('game:pickExe', async (_e, id) => {
    const g = id && library.get(id);
    const res = await dialog.showOpenDialog(win, {
      title: 'Choisir l’exécutable du jeu',
      defaultPath: g ? path.dirname(g.exe) : library.settings.roots[0],
      filters: [{ name: 'Programmes', extensions: ['exe', 'bat', 'cmd', 'lnk', 'url'] }],
      properties: ['openFile'],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('game:addManual', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Ajouter un jeu',
      filters: [{ name: 'Programmes', extensions: ['exe'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const g = library.addManual(res.filePaths[0]);
    queueArt(g.id, {}, true);
    return decorate(g);
  });

  ipcMain.handle('steam:search', (_e, term) => steamSearch(term).catch(() => []));

  ipcMain.handle('settings:update', (_e, patch) => library.updateSettings(patch));
  ipcMain.handle('settings:pickRoot', async () => {
    const res = await dialog.showOpenDialog(win, { title: 'Ajouter un dossier de jeux', properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('settings:refetchAll', () => {
    for (const g of library.list()) queueArt(g.id, { force: true });
  });

  ipcMain.on('window:minimize', () => win.minimize());
  ipcMain.on('window:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.on('window:close', () => win.close());
  ipcMain.on('window:fullscreen', (_e, on) => win.setFullScreen(!!on));
}

launcher.on('started', (id) => send('game:updated', decorate(library.get(id))));
launcher.on('stopped', (id, seconds, start) => {
  const g = library.get(id);
  if (!g) return;
  const updated = library.update(id, { playtime: (g.playtime || 0) + seconds, lastPlayed: Date.now() });
  // Sessions under a minute are usually a crash or a launcher closing itself.
  const session = seconds >= 60 ? library.addSession(id, start, seconds) : null;
  send('game:updated', decorate(updated));
  send('session:ended', { id, seconds, session });
  if (win && win.isMinimized() && !launcher.runningIds().length) win.restore();
});
launcher.on('error', (id, message) => send('toast', { type: 'error', text: `Impossible de lancer le jeu : ${message}` }));

app.whenReady().then(() => {
  library = new Library(app.getPath('userData'));

  // media://local/<encoded absolute path> — only serves images referenced by the library.
  protocol.handle('media', async (req) => {
    const file = decodeURIComponent(new URL(req.url).pathname.slice(1));
    const allowed = library.list().some((g) => [g.cover, g.hero, g.logo].includes(file));
    if (!allowed || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    // CORS header so the renderer can read pixels (dominant colour of covers).
    return new Response(res.body, {
      headers: { 'Content-Type': res.headers.get('content-type') || 'image/jpeg', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=31536000' },
    });
  });

  registerIpc();
  createWindow();
  win.webContents.once('did-finish-load', () => {
    const games = rescan();
    send('library:changed', games);
  });
});

app.on('before-quit', () => library && library.saveNow());
app.on('window-all-closed', () => app.quit());
