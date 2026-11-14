// Persistent library (games + settings) stored as JSON in the user data folder.
const fs = require('fs');
const path = require('path');
const { scanRoots, scanFolder, gameId } = require('./scanner');
const { STORES } = require('./stores');

// Setting that turns a launcher's import on/off: importSteam, importEpic, importEa, importUbisoft…
const importKey = (store) => 'import' + store[0].toUpperCase() + store.slice(1);

const DEFAULT_SETTINGS = {
  roots: ['D:\\Games'],
  excluded: ['NovaLauncher', 'build'],
  minimizeOnLaunch: true,
  accent: '#8b7bff',
  cardSize: 190,
  sort: 'name',
  ...Object.fromEntries(STORES.map((s) => [importKey(s.id), true])),
};

// Fields owned by the user: a rescan never overwrites them once set by hand.
const USER_FIELDS = ['name', 'exe', 'args'];

class Library {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'library.json');
    this.artDir = path.join(dir, 'art');
    this.data = { settings: { ...DEFAULT_SETTINGS }, games: {}, sessions: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
      this.data.games = raw.games || {};
      this.data.sessions = raw.sessions || [];
      this._dailyBackup();
    } catch {}
    this._saveTimer = null;
  }

  // One copy of library.json per day in backups/, the 7 most recent are kept.
  _dailyBackup() {
    try {
      const dir = path.join(this.dir, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      const dest = path.join(dir, `library-${day}.json`);
      if (!fs.existsSync(dest)) fs.copyFileSync(this.file, dest);
      const old = fs.readdirSync(dir).filter((f) => /^library-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -7);
      for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
    } catch {}
  }

  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    clearTimeout(this._saveTimer);
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get settings() {
    return this.data.settings;
  }

  list() {
    return Object.values(this.data.games);
  }

  get(id) {
    return this.data.games[id];
  }

  update(id, patch) {
    const g = this.data.games[id];
    if (!g) return null;
    for (const k of USER_FIELDS) if (k in patch && patch[k] !== g[k]) g.custom = { ...g.custom, [k]: true };
    Object.assign(g, patch);
    this.save();
    return g;
  }

  // Play sessions: { id, game, start, seconds, note? }, oldest first.
  get sessions() {
    return this.data.sessions;
  }

  addSession(game, start, seconds) {
    const s = { id: `${start}-${game}`, game, start, seconds };
    this.data.sessions.push(s);
    this.save();
    return s;
  }

  updateSession(id, patch) {
    const s = this.data.sessions.find((x) => x.id === id);
    if (!s) return null;
    Object.assign(s, patch);
    this.save();
    return s;
  }

  updateSettings(patch) {
    Object.assign(this.data.settings, patch);
    this.save();
    return this.data.settings;
  }

  _merge(found, extra = {}) {
    const old = this.data.games[found.id];
    if (!old) {
      this.data.games[found.id] = {
        ...found,
        favorite: false,
        hidden: false,
        playtime: 0,
        lastPlayed: null,
        addedAt: Date.now(),
        custom: {},
        ...extra,
      };
      return;
    }
    const custom = old.custom || {};
    for (const [k, v] of Object.entries(found)) {
      if (USER_FIELDS.includes(k) && custom[k]) continue;
      old[k] = v;
    }
    if (custom.exe && !fs.existsSync(old.exe)) old.exe = found.exe; // the hand-picked exe vanished
  }

  rescan() {
    const { roots, excluded } = this.data.settings;
    const importOn = Object.fromEntries(STORES.map((s) => [s.id, this.data.settings[importKey(s.id)] !== false]));
    const found = scanRoots(roots, excluded);
    const folders = new Set(found.map((f) => f.folder.toLowerCase()));
    // A game seen twice (scanned folder, or two launchers sharing a folder) is kept once: local first,
    // then launchers in STORES order.
    for (const store of STORES) {
      if (!importOn[store.id]) continue;
      let games = [];
      try {
        games = store.scan();
      } catch {}
      for (const s of games) {
        if (folders.has(s.folder.toLowerCase())) continue;
        folders.add(s.folder.toLowerCase());
        found.push(s);
      }
    }
    const seen = new Set();
    for (const f of found) {
      this._merge(f);
      seen.add(f.id);
    }
    for (const g of this.list()) {
      // A store game being updated or verified drops out of its launcher's list for a while:
      // keep it (with its favourites, status, notes…) as long as its folder is still there.
      const updating = g.source && g.source !== 'local' && importOn[g.source] && fs.existsSync(g.folder);
      if (g.manual ? !fs.existsSync(g.exe) : !seen.has(g.id) && !updating) delete this.data.games[g.id];
    }
    this.save();
    return this.list();
  }

  // A game picked by hand (exe anywhere on disk).
  addManual(exePath) {
    const folder = path.dirname(exePath);
    const scanned = scanFolder(folder) || {};
    const id = gameId(exePath);
    const name = path.basename(folder).replace(/[._]+/g, ' ').trim();
    this._merge(
      { id, folder, folderName: path.basename(folder), name, exe: exePath, args: '', candidates: scanned.candidates || [exePath] },
      { manual: true, custom: { exe: true } }
    );
    this.save();
    return this.data.games[id];
  }
}

module.exports = { Library, importKey };
