// Scans root folders: each direct subfolder is a game, and we guess its main executable.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_DEPTH = 5;

const SKIP_DIRS = /^(_?commonredist|_?redist|redist|redistributables?|directx|dotnet|vcredist|support|__installer|installer|extras|engine|tools|_windows 7 fix|crashreport.*|easyanticheat|battleye|plugins|mono|monobleedingedge|.*_data|dist|node_modules|\.git|shader.*|user|logs?|saves?)$/i;

const SKIP_EXES = /(unins|setup|install|redist|dxweb|dxsetup|oalinst|dotnet|crash|report|upload|helper|cefprocess|subprocess|webengine|handler|cleaner|attestation|downloader|protocolselector|kexsetup|prereq|update|patch|xboxliveauth|-cmd|editor|moduploader|bootstrapper|_loader|launcherpatch|config|benchmark|dedicated|server|vc_?redist|7z|winrar)/i;

const EMULATORS = /^(yuzu|yuzu_ea|suyu|sudachi|citron|ryujinx|cemu|dolphin|rpcs3|pcsx2.*|ppsspp.*|duckstation.*)\.exe$/i;

function gameId(folder) {
  return crypto.createHash('sha1').update(folder.toLowerCase()).digest('hex').slice(0, 12);
}

function tokens(str) {
  return str
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function initials(str) {
  return tokens(str).map((t) => t[0]).join('');
}

function listExes(dir, depth = 0, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < MAX_DEPTH && !SKIP_DIRS.test(e.name)) listExes(full, depth + 1, out);
    } else if (e.isFile() && /\.exe$/i.test(e.name)) {
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {}
      out.push({ path: full, name: e.name, depth, size });
    }
  }
  return out;
}

function scoreExe(exe, gameName) {
  const base = exe.name.replace(/\.exe$/i, '');
  if (SKIP_EXES.test(base)) return -Infinity;
  if (exe.size < 60 * 1024) return -Infinity;

  let score = 0;
  score -= exe.depth * 12;
  score += Math.min(10, Math.log2(exe.size / 1024 / 64)); // bigger is (slightly) better

  const gTok = tokens(gameName);
  const eTok = tokens(base.replace(/-win64-shipping/i, ''));
  const eJoined = eTok.join('');
  const overlap = eTok.filter((t) => gTok.includes(t) || (t.length >= 3 && gTok.join('').includes(t))).length;
  score += overlap * 8;
  if (eJoined && gTok.join('').includes(eJoined)) score += 10;
  const ini = initials(gameName);
  if (eTok[0] && ini.length >= 2 && (eTok[0].startsWith(ini) || ini.startsWith(eTok[0]))) score += 12;

  if (/-win64-shipping$/i.test(base)) score -= 6; // prefer the root UE stub when there is one
  if (/launcher/i.test(base)) score -= 8;
  if (/(_ea|-l)$/i.test(base)) score -= 3;
  if (EMULATORS.test(exe.name)) score += 20;
  return score;
}

// "Spongebob.Squarepants-The.Patrick.Star.Game-SteamRIP.com" -> use the inner folder name instead.
function cleanName(folderName, exePath, folder) {
  let name = folderName;
  const rel = path.relative(folder, path.dirname(exePath));
  const firstSub = rel && !rel.startsWith('..') ? rel.split(path.sep)[0] : '';
  const messy = /steamrip|fitgirl|dodi|elamigos|repack|\w\.\w+\.\w/i.test(folderName);
  if (messy && firstSub && !SKIP_DIRS.test(firstSub)) name = firstSub;
  return name
    .replace(/[-_. ]*(steamrip\.com|steamrip|fitgirl.*|dodi.*|elamigos.*|repack.*)$/i, '')
    .replace(/\.(?=\S)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// yuzu & co: re-open the last game from the emulator's own config.
function emulatorArgs(exePath) {
  if (!/^(yuzu|yuzu_ea|suyu|sudachi|citron)\.exe$/i.test(path.basename(exePath))) return '';
  const cfg = path.join(path.dirname(exePath), 'user', 'config', 'qt-config.ini');
  try {
    const m = fs.readFileSync(cfg, 'utf8').match(/^Paths\\recentFiles=(.+)$/m);
    const file = m && m[1].split(',')[0].trim();
    if (file && fs.existsSync(file)) return `-f -g "${file.replace(/\//g, '\\')}"`;
  } catch {}
  return '';
}

function scanFolder(folder) {
  const folderName = path.basename(folder);
  const exes = listExes(folder);
  if (!exes.length) return null;
  const ranked = exes
    .map((e) => ({ ...e, score: scoreExe(e, folderName) }))
    .filter((e) => e.score > -Infinity)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  const best = ranked[0];
  return {
    id: gameId(folder),
    folder,
    folderName,
    name: cleanName(folderName, best.path, folder),
    exe: best.path,
    args: emulatorArgs(best.path),
    candidates: ranked.slice(0, 8).map((e) => e.path),
  };
}

function scanRoots(roots, excluded = []) {
  const ex = excluded.map((e) => e.toLowerCase());
  const games = [];
  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || ex.includes(e.name.toLowerCase())) continue;
      const g = scanFolder(path.join(root, e.name));
      if (g) games.push(g);
    }
  }
  return games;
}

module.exports = { scanRoots, scanFolder, listExes, gameId, tokens };
