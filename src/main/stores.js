// Games installed through Steam and the Epic Games Launcher.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
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

module.exports = { steamGames, epicGames, parseVdf };
