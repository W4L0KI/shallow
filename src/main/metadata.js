// Fetches covers, hero art, logo and description from Steam (no API key), Wikipedia as a fallback.
const fs = require('fs');
const path = require('path');
const { tokens } = require('./scanner');

const UA = 'ShallowLauncher/1.0 (local game launcher)';
const STEAM_ASSETS = 'https://shared.cloudflare.steamstatic.com/store_item_assets/';
const LEGACY_CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps/';

const ALIASES = [
  [/\bfnaf\b/i, "Five Nights at Freddy's"],
  [/\bgta\b/i, 'Grand Theft Auto'],
  [/\bcod\b/i, 'Call of Duty'],
  [/\brdr\s?2\b/i, 'Red Dead Redemption 2'],
];

const JUNK = /(soundtrack|ost\b|upgrade|season pass|dlc|pack\b|bundle|demo|sample|skin|playtest|artbook|vip|membership|costume|expansion pass)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    if (i + 1 >= tries || (res.status !== 429 && res.status < 500)) throw new Error(`HTTP ${res.status}`);
    await sleep(1500 * (i + 1));
  }
}

const ROMAN = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
const normTokens = (s) => tokens(s).map((t) => ROMAN[t] || t);

function similarity(a, b) {
  const A = new Set(normTokens(a));
  const B = new Set(normTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function expandAliases(name) {
  let aliased = name;
  for (const [re, full] of ALIASES) aliased = aliased.replace(re, full);
  return aliased;
}

const TO_ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

function searchTerms(name) {
  const flat = (t) => t.replace(/\s[-–:]\s/g, ' ').replace(/\s+/g, ' ').trim();
  const aliased = expandAliases(name);
  const terms = [aliased, name, flat(aliased), flat(name)];
  terms.push(flat(name).replace(/\b([1-9]|10)\b/g, (n) => TO_ROMAN[+n]));
  const noSuffix = name.split(/\s[-–:]\s/)[0];
  if (noSuffix !== name && noSuffix.length > 3) terms.push(noSuffix);
  return [...new Set(terms)];
}

async function steamSearch(term) {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=FR`;
  const data = await getJson(url);
  return (data.items || []).map((i) => ({ appid: i.id, name: i.name, image: i.tiny_image }));
}

async function steamItems(appids) {
  const q = {
    ids: appids.map((appid) => ({ appid })),
    context: { language: 'french', country_code: 'FR' },
    data_request: { include_assets: true, include_basic_info: true, include_release: true },
  };
  const url = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json=${encodeURIComponent(JSON.stringify(q))}`;
  const data = await getJson(url);
  return (data.response && data.response.store_items) || [];
}

function assetUrl(assets, file) {
  return file ? STEAM_ASSETS + assets.asset_url_format.replace('${FILENAME}', file) : null;
}

async function rankSteam(name, terms, refs) {
  const seen = new Map();
  for (const term of terms) {
    let results = [];
    try {
      results = await steamSearch(term);
    } catch {
      continue;
    }
    for (const r of results) {
      if (seen.has(r.appid)) continue;
      let score = Math.max(...refs.map((ref) => similarity(ref, r.name)));
      if (JUNK.test(r.name) && !JUNK.test(name)) score -= 0.5;
      seen.set(r.appid, { ...r, score });
    }
  }
  return [...seen.values()].filter((r) => r.score >= 0.34).sort((a, b) => b.score - a.score);
}

async function firstWithArt(ranked) {
  if (!ranked.length) return null;
  const top = ranked.slice(0, 5);
  const items = await steamItems(top.map((r) => r.appid));
  for (const r of top) {
    const it = items.find((i) => i.appid === r.appid);
    if (it && it.assets && it.assets.library_capsule) return { ...it, name: r.name };
  }
  return null;
}

// Best Steam match for a local game name, or null.
async function findSteamApp(name) {
  const refs = [name, expandAliases(name)];
  const found = await firstWithArt(await rankSteam(name, searchTerms(name), refs));
  if (found) return found;
  // Last resort (e.g. a DLC-named folder): drop trailing words and look for the base game.
  const words = name.split(/\s+/);
  for (let n = words.length - 1; n >= 2; n--) {
    const short = words.slice(0, n).join(' ');
    const hit = await firstWithArt((await rankSteam(name, [short], [short])).filter((r) => r.score >= 0.5));
    if (hit) return { ...hit, partialMatch: true };
  }
  return null;
}

function steamInfo(item) {
  const a = item.assets;
  const b = item.basic_info || {};
  const release = item.release && item.release.steam_release_date;
  return {
    steamAppId: item.appid,
    steamName: item.name.replace(/[™®©]/g, '').trim(),
    partialMatch: !!item.partialMatch,
    description: b.short_description || '',
    developer: (b.developers || []).map((d) => d.name).join(', '),
    publisher: (b.publishers || []).map((d) => d.name).join(', '),
    year: release ? new Date(release * 1000).getFullYear() : null,
    urls: {
      cover: assetUrl(a, a.library_capsule_2x || a.library_capsule),
      hero: assetUrl(a, a.library_hero_2x || a.library_hero || a.page_background),
      logo: [assetUrl(a, 'logo_2x.png'), assetUrl(a, 'logo.png'), `${LEGACY_CDN}${item.appid}/logo.png`],
    },
  };
}

async function wikipediaCover(name) {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=1' +
    `&gsrsearch=${encodeURIComponent(name + ' video game')}` +
    '&prop=pageimages|extracts&exintro=1&explaintext=1&exsentences=2&piprop=original&pilicense=any';
  const data = await getJson(url);
  const page = data.query && Object.values(data.query.pages)[0];
  if (!page || !page.original) return null;
  return { description: page.extract || '', urls: { cover: page.original.source, hero: null, logo: [] } };
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok || !/^image\//.test(res.headers.get('content-type') || '')) return false;
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

// Downloads art for a game into dir; returns the fields to merge into the game record.
async function fetchArt(name, id, dir, { appid, steamName } = {}) {
  let info = null;
  let source = 'steam';
  try {
    if (appid) {
      const [item] = await steamItems([appid]);
      if (item && item.assets) info = steamInfo({ ...item, name: steamName || item.name });
    } else {
      const item = await findSteamApp(name);
      if (item) info = steamInfo(item);
    }
  } catch {}
  if (!info) {
    source = 'wikipedia';
    try {
      info = await wikipediaCover(name);
    } catch {}
  }
  if (!info) return null;

  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  const out = { coverSource: source };
  const file = (kind, ext) => path.join(dir, `${id}-${kind}-${stamp}.${ext}`);

  // Remove previous auto-downloaded art for this game.
  for (const f of fs.readdirSync(dir)) if (f.startsWith(`${id}-`)) fs.rmSync(path.join(dir, f), { force: true });

  if (info.urls.cover) {
    const p = file('cover', 'jpg');
    if (await download(info.urls.cover, p)) out.cover = p;
  }
  if (info.urls.hero) {
    const p = file('hero', 'jpg');
    if (await download(info.urls.hero, p)) out.hero = p;
  }
  for (const u of info.urls.logo) {
    const p = file('logo', 'png');
    if (await download(u, p)) {
      out.logo = p;
      break;
    }
  }
  for (const k of ['steamAppId', 'steamName', 'partialMatch', 'description', 'developer', 'publisher', 'year']) {
    if (info[k] !== undefined) out[k] = info[k];
  }
  return out;
}

module.exports = { fetchArt, steamSearch, similarity };
