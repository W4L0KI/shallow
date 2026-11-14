// Games installed through PC launchers: Steam, Epic Games, EA app, Ubisoft Connect, Riot, Battle.net, GOG, Xbox.
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { scanFolder } = require('./scanner');

// Steam installs tools, runtimes and apps next to games; manifests don't tell them apart.
const STEAM_SKIP_IDS = new Set([228980, 1070560, 1391110, 1628350, 1493710, 250820, 1905180, 431960]);
const STEAM_SKIP_NAMES = /redistributable|proton|steam linux runtime|steamvr|soundtrack|dedicated server|\bsdk\b|wallpaper engine|obs studio|steamworks|ubisoft connect|soundpad/i;

// Minimal parser for Valve's KeyValues text format (libraryfolders.vdf, appmanifest_*.acf).
function parseVdf(text) {
  const root = {};
  const stack = [root];
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  let key = null;
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[2] === '{') {
      const obj = {};
      top[key] = obj;
      stack.push(obj);
      key = null;
    } else if (m[2] === '}') {
      stack.pop();
    } else if (key === null) {
      key = m[1].replace(/\\\\/g, '\\');
    } else {
      top[key] = m[1].replace(/\\\\/g, '\\');
      key = null;
    }
  }
  return root;
}

function steamRoot() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true });
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (m) return path.normalize(m[1].trim());
  } catch {}
  const fallback = 'C:\\Program Files (x86)\\Steam';
  return fs.existsSync(fallback) ? fallback : null;
}

function steamGames() {
  const root = steamRoot();
  if (!root) return [];
  let libraries = [root];
  try {
    const vdf = parseVdf(fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'));
    const folders = vdf.libraryfolders || {};
    libraries = [root, ...Object.values(folders).map((f) => f && f.path).filter(Boolean)].map((p) => path.normalize(p));
  } catch {}
  libraries = [...new Map(libraries.map((p) => [p.toLowerCase(), p])).values()];

  const games = [];
  for (const lib of libraries) {
    const apps = path.join(lib, 'steamapps');
    let files = [];
    try {
      files = fs.readdirSync(apps).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const st = parseVdf(fs.readFileSync(path.join(apps, f), 'utf8')).AppState;
        const appid = Number(st.appid);
        if (!st || STEAM_SKIP_IDS.has(appid) || STEAM_SKIP_NAMES.test(st.name)) continue;
        if (!(Number(st.StateFlags) & 4)) continue; // not fully installed
        const folder = path.join(apps, 'common', st.installdir);
        if (!fs.existsSync(folder)) continue;
        const scanned = scanFolder(folder) || {};
        games.push({
          id: `steam-${appid}`,
          source: 'steam',
          folder,
          folderName: st.installdir,
          name: st.name,
          exe: scanned.exe || '',
          args: '',
          candidates: scanned.candidates || [],
          launchUri: `steam://rungameid/${appid}`,
          steamAppId: appid,
        });
      } catch {}
    }
  }
  return games;
}

function epicGames() {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.item'));
  } catch {
    return [];
  }
  // While a game updates, Epic moves its manifest to Pending/: an already-installed game still counts.
  try {
    for (const f of fs.readdirSync(path.join(dir, 'Pending'))) if (f.endsWith('.item') && !files.includes(f)) files.push(path.join('Pending', f));
  } catch {}
  const games = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const cats = j.AppCategories || [];
      if (!j.LaunchExecutable || !cats.includes('games') || cats.includes('hidden') || cats.some((c) => c.startsWith('plugins'))) continue;
      const pending = f.startsWith('Pending');
      if (!fs.existsSync(j.InstallLocation)) continue;
      if (pending ? !fs.existsSync(path.join(j.InstallLocation, j.LaunchExecutable)) : j.bIsIncompleteInstall) continue;
      const exe = path.join(j.InstallLocation, j.LaunchExecutable);
      const scanned = scanFolder(j.InstallLocation) || {};
      games.push({
        id: `epic-${j.AppName}`.toLowerCase(),
        source: 'epic',
        folder: j.InstallLocation,
        folderName: path.basename(j.InstallLocation),
        name: j.DisplayName.replace(/[®™]/g, '').trim(),
        exe: fs.existsSync(exe) ? exe : scanned.exe || '',
        args: '',
        candidates: scanned.candidates || [],
        epicNamespace: j.CatalogNamespace,
        epicItemId: j.CatalogItemId,
        launchUri: `com.epicgames.launcher://apps/${j.CatalogNamespace}%3A${j.CatalogItemId}%3A${j.AppName}?action=launch&silent=true`,
      });
    } catch {}
  }
  return games;
}

// --- Windows "installed programs": EA app, Ubisoft Connect, Riot and Battle.net register every game there ---

let uninstallCache = null;

const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

// Values of every subkey under a registry key, from `reg query /s` output.
function parseReg(out) {
  const entries = [];
  let cur = null;
  for (const line of out.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) {
      cur = { path: line.trim(), key: line.trim().split('\\').pop(), values: {} };
      entries.push(cur);
    } else if (cur) {
      const m = /^\s{4}(.+?)\s{4}REG_(?:SZ|EXPAND_SZ|DWORD)\s{4}(.*)$/.exec(line);
      if (m) cur.values[m[1].toLowerCase()] = m[2].trim();
    }
  }
  return entries;
}

const REG_OPTS = { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 };

function regSubkeys(key) {
  try {
    return parseReg(execFileSync('reg', ['query', key, '/s'], { ...REG_OPTS, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return [];
  }
}

const regSubkeysAsync = (key) => new Promise((resolve) => execFile('reg', ['query', key, '/s'], REG_OPTS, (err, out) => resolve(err ? [] : parseReg(out))));

const toEntries = (keys) =>
  keys
    .filter((e) => e.values.displayname)
    .map((e) => ({ key: e.key, name: e.values.displayname, location: e.values.installlocation, icon: e.values.displayicon, uninstall: e.values.uninstallstring }));

// Reading the whole "installed programs" list takes seconds: main.js loads it in the background
// (refreshInstalledPrograms) before each scan, so the scan itself never blocks the window.
async function refreshInstalledPrograms() {
  const parts = await Promise.all(UNINSTALL_KEYS.map(regSubkeysAsync));
  uninstallCache = { at: Date.now(), list: toEntries(parts.flat()) };
}

function uninstallEntries() {
  if (!uninstallCache) uninstallCache = { at: Date.now(), list: toEntries(UNINSTALL_KEYS.flatMap(regSubkeys)) };
  return uninstallCache.list;
}

const cleanPath = (p) => (p ? path.normalize(String(p).replace(/^"|"$/g, '').replace(/,\d+$/, '').replace(/[\\/]+$/, '')) : '');
const cleanName = (n) => String(n).replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();

// A store game record from an install folder (main exe guessed like for local games).
function storeGame(source, id, name, folder, { exe, ...extra } = {}) {
  if (!folder || !fs.existsSync(folder)) return null;
  const scanned = scanFolder(folder) || {};
  const known = exe && /\.exe$/i.test(exe) && fs.existsSync(exe) ? exe : null;
  return {
    id: `${source}-${id}`.toLowerCase(),
    source,
    folder,
    folderName: path.basename(folder),
    name: cleanName(name),
    exe: known || scanned.exe || '',
    args: '',
    candidates: scanned.candidates || [],
    ...extra,
  };
}

function ubisoftGames() {
  // "Uplay Install <id>" entries; Ubisoft Connect launches them by id.
  return uninstallEntries()
    .map((e) => {
      const m = /^Uplay Install (\d+)$/.exec(e.key);
      return m && storeGame('ubisoft', m[1], e.name, cleanPath(e.location), { launchUri: `uplay://launch/${m[1]}/0` });
    })
    .filter(Boolean);
}

function eaGames() {
  // Games installed by the EA app are uninstalled through EAInstaller. Their own exe starts the EA app if needed.
  return uninstallEntries()
    .filter((e) => /EAInstaller/i.test(e.uninstall || '') && e.location)
    .map((e) => storeGame('ea', e.key.replace(/[{}]/g, ''), e.name, cleanPath(e.location), { exe: cleanPath(e.icon) }))
    .filter(Boolean);
}

function riotGames() {
  // "Riot Game <product>.<patchline>"; the Riot Client starts them (login, updates, Vanguard).
  return uninstallEntries()
    .map((e) => {
      const m = /^Riot Game ([a-z0-9_]+)\.([a-z0-9_]+)$/i.exec(e.key);
      if (!m || /riot_client/i.test(m[1])) return null;
      const client = (/"([^"]*RiotClientServices\.exe)"/i.exec(e.uninstall || '') || [])[1];
      if (!client) return null;
      return storeGame('riot', `${m[1]}.${m[2]}`, e.name, cleanPath(e.location), {
        launchExe: path.normalize(client),
        launchArgs: `--launch-product=${m[1]} --launch-patchline=${m[2]}`,
      });
    })
    .filter(Boolean);
}

function battlenetGames() {
  // Blizzard games are removed with "Blizzard Uninstaller.exe … --uid=<game>"; their exe hands over to Battle.net.
  return uninstallEntries()
    .map((e) => {
      const uid = (/--uid=([\w.-]+)/.exec(e.uninstall || '') || [])[1];
      if (!uid || uid === 'battle.net' || !/Blizzard Uninstaller/i.test(e.uninstall)) return null;
      return storeGame('battlenet', uid, e.name, cleanPath(e.location), { exe: cleanPath(e.icon) });
    })
    .filter(Boolean);
}

function gogGames() {
  // GOG Galaxy writes one registry key per game (GOG games are DRM-free: their exe runs directly).
  return regSubkeys('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games')
    .filter((e) => /^\d+$/.test(e.key) && e.values.gamename && e.values.path)
    .map((e) => storeGame('gog', e.key, e.values.gamename, cleanPath(e.values.path), { exe: cleanPath(e.values.exe) }))
    .filter(Boolean);
}

function xboxGames() {
  // Xbox app / Game Pass PC games live in <drive>:\XboxGames\<Game>\Content and start through their app id.
  const games = [];
  for (const drive of 'CDEFGH') {
    const root = `${drive}:\\XboxGames`;
    let dirs = [];
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'GameSave');
    } catch {
      continue;
    }
    for (const d of dirs) {
      const content = path.join(root, d.name, 'Content');
      let cfg = '';
      try {
        cfg = fs.readFileSync(path.join(content, 'MicrosoftGame.config'), 'utf8');
      } catch {
        continue;
      }
      const identity = (/<Identity\b[^>]*\bName="([^"]+)"/.exec(cfg) || [])[1];
      const appId = (/<Executable\b[^>]*\bId="([^"]+)"/.exec(cfg) || [])[1];
      const title = (/<ShellVisuals\b[^>]*\bDefaultDisplayName="([^"]+)"/.exec(cfg) || [])[1] || d.name;
      if (!identity) continue;
      let family = '';
      try {
        family = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-AppxPackage -Name '${identity.replace(/'/g, '')}').PackageFamilyName`], { encoding: 'utf8', windowsHide: true }).trim();
      } catch {}
      const g = storeGame('xbox', identity, title, content, family && appId ? { launchUri: `shell:AppsFolder\\${family}!${appId}` } : {});
      if (g) games.push(g);
    }
  }
  return games;
}

// Every supported launcher, in display order.
const STORES = [
  { id: 'steam', label: 'Steam', scan: steamGames },
  { id: 'epic', label: 'Epic Games', scan: epicGames },
  { id: 'ea', label: 'EA app', scan: eaGames },
  { id: 'ubisoft', label: 'Ubisoft Connect', scan: ubisoftGames },
  { id: 'riot', label: 'Riot Games', scan: riotGames },
  { id: 'battlenet', label: 'Battle.net', scan: battlenetGames },
  { id: 'gog', label: 'GOG', scan: gogGames },
  { id: 'xbox', label: 'Xbox', scan: xboxGames },
];

module.exports = { STORES, refreshInstalledPrograms, steamGames, epicGames, parseVdf };
