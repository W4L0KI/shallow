// Persistent library (games + settings) stored as JSON in the user data folder.
const fs = require('fs');
const path = require('path');
const { scanRoots, scanFolder, gameId } = require('./scanner');

const DEFAULT_SETTINGS = {
  roots: ['D:\\Games'],
  excluded: ['NovaLauncher', 'build'],
  minimizeOnLaunch: true,
  accent: '#8b7bff',
  cardSize: 190,
  sort: 'name',
};

// Fields owned by the user: a rescan never overwrites them once set by hand.
const USER_FIELDS = ['name', 'exe', 'args'];

class Library {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'library.json');
    this.artDir = path.join(dir, 'art');
    this.data = { settings: { ...DEFAULT_SETTINGS }, games: {} };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
      this.data.games = raw.games || {};
    } catch {}
    this._saveTimer = null;
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
    const found = scanRoots(roots, excluded);
    const seen = new Set();
    for (const f of found) {
      this._merge(f);
      seen.add(f.id);
    }
    for (const g of this.list()) {
      if (g.manual ? !fs.existsSync(g.exe) : !seen.has(g.id)) delete this.data.games[g.id];
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

module.exports = { Library };
