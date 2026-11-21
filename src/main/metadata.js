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
  // "Wheel Mates" and "WheelMates" are the same title.
  if (normTokens(a).join('') && normTokens(a).join('') === normTokens(b).join('')) return 1;
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
    data_request: { include_assets: true, include_basic_info: true, include_release: true, include_screenshots: true },
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

// Best Steam match for a local game name, or null. `strict` (games from other launchers, whose
// exact name we know) refuses loose matches like "League of Legends" -> "…: A League of Legends Story".
async function findSteamApp(name, { strict = false } = {}) {
  const refs = [name, expandAliases(name)];
  const ranked = await rankSteam(name, searchTerms(name), refs);
  const found = await firstWithArt(strict ? ranked.filter((r) => r.score >= 0.75) : ranked);
  if (found || strict) return found;
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
  // Background: library hero, then the legacy CDN copy, the store page background, and a full-size screenshot.
  const shots = ((item.screenshots && item.screenshots.all_ages_screenshots) || []).map((s) => STEAM_ASSETS + s.filename.replace(/\.jpg/, '.1920x1080.jpg'));
  return {
    steamAppId: item.appid,
    steamName: item.name.replace(/[™®©]/g, '').trim(),
    partialMatch: !!item.partialMatch,
    description: b.short_description || '',
    developer: (b.developers || []).map((d) => d.name).join(', '),
    publisher: (b.publishers || []).map((d) => d.name).join(', '),
    year: release ? new Date(release * 1000).getFullYear() : null,
    urls: {
      cover: [assetUrl(a, a.library_capsule_2x || a.library_capsule), `${LEGACY_CDN}${item.appid}/library_600x900_2x.jpg`],
      hero: [
        assetUrl(a, a.library_hero_2x || a.library_hero),
        `${LEGACY_CDN}${item.appid}/library_hero.jpg`,
        shots[0],
        assetUrl(a, a.page_background),
      ],
      logo: [assetUrl(a, 'logo_2x.png'), assetUrl(a, 'logo.png'), `${LEGACY_CDN}${item.appid}/logo.png`],
    },
  };
}

// --- Epic Games: the launcher keeps the catalog of your games (with their art) on disk ---

const EPIC_CATALOG = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Catalog', 'catcache.bin');

function epicCatalog() {
  try {
    return JSON.parse(Buffer.from(fs.readFileSync(EPIC_CATALOG, 'utf8'), 'base64').toString('utf8'));
  } catch {
    return [];
  }
}

// Exact item for an installed Epic game, or the closest title among the games you own on Epic.
function epicInfo(name, { itemId, namespace } = {}) {
  const items = epicCatalog().filter((it) => (it.keyImages || []).some((k) => k.type === 'DieselGameBoxTall'));
  let it = itemId && items.find((x) => x.id === itemId);
  if (!it) {
    const ranked = items
      .filter((x) => !namespace || x.namespace === namespace)
      .map((x) => ({ x, score: similarity(name, x.title) }))
      .filter((r) => r.score >= (namespace ? 0.3 : 0.6))
      .sort((a, b) => b.score - a.score);
    it = ranked.length && ranked[0].x;
  }
  if (!it) return null;
  const img = (type, size) => (it.keyImages.filter((k) => k.type === type).map((k) => `${k.url}${size ? `?resize=1&${size}` : ''}`));
  return {
    // The cache stores "®" as a literal "?": an installed game keeps its manifest name instead.
    steamName: itemId && it.id === itemId ? undefined : it.title.replace(/[™®©�]|\?$/g, '').trim(),
    partialMatch: false,
    // Some catalog entries only repeat the title here ("Rocket League?"): not a description.
    description: it.description && similarity(it.description, it.title) < 0.8 ? it.description : '',
    developer: it.developer || '',
    urls: { cover: img('DieselGameBoxTall', 'w=600&h=800'), hero: img('DieselGameBox', 'w=1920&h=1080'), logo: img('DieselGameBoxLogo') },
  };
}

// The Epic cache stores every accented letter as a literal "?" ("vari?t?", "C?dez"): unreadable, and the
// original text can't be recovered from it.
const garbled = (s) => /\p{L}\?\p{L}/u.test(s || '');

// Clean description for a game whose catalog text is garbled: Epic's public store page (older games),
// then its French Steam page when it is clearly the same game, else nothing (better than broken text).
async function cleanDescription(title) {
  const ok = (s) => s && s.length > 20 && !garbled(s);
  const slug = title.toLowerCase().replace(/[™®©?]/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  try {
    const r = await getJson(`https://store-content.ak.epicgames.com/api/fr/content/products/${slug}`, 1);
    const home = (r.pages || []).find((p) => p._slug === 'home') || (r.pages || [])[0];
    const about = (home && home.data && home.data.about) || {};
    if (ok(about.shortDescription)) return about.shortDescription.trim();
  } catch {}
  try {
    const item = await findSteamApp(title, { strict: true });
    const desc = item && similarity(title, item.name) >= 0.8 && (item.basic_info || {}).short_description;
    if (ok(desc)) return desc.trim();
  } catch {}
  return '';
}

// --- Riot Games: the Riot Client's own theme for each game (library card, background, logo) on Riot's CDN ---

async function riotInfo(product) {
  const base = `https://${product}.secure.dyn.riotcdn.net/channels/public/rccontent/theme/`;
  const m = await getJson(base + 'manifest.json', 1);
  const lib = m.game_library || {};
  const u = (f) => (f ? [base + f] : []);
  return {
    description: '',
    landscapeCover: true, // the library card is 3:2, logo on the left and characters on the right
    urls: {
      cover: u(lib.game_card_image || lib.product_card_image),
      hero: u((m.product_details || {}).background_image || m.product_image),
      logo: u(m.logo_image),
    },
  };
}

// Landscape art -> 3:4 portrait cover, keeping the right side (where Riot puts the characters).
function cropPortrait(file) {
  try {
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromPath(file);
    const { width, height } = img.getSize();
    const w = Math.round((height * 3) / 4);
    if (!width || w >= width) return;
    fs.writeFileSync(file, img.crop({ x: width - w, y: 0, width: w, height }).toJPEG(92));
  } catch {}
}

async function wikipediaCover(name) {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=1' +
    `&gsrsearch=${encodeURIComponent(name + ' video game')}` +
    '&prop=pageimages|extracts&exintro=1&explaintext=1&exsentences=2&piprop=original&pilicense=any';
  const data = await getJson(url);
  const page = data.query && Object.values(data.query.pages)[0];
  if (!page || !page.original) return null;
  return { description: page.extract || '', urls: { cover: [page.original.source], hero: [], logo: [] } };
}

// "BOMBANANA! Demo" -> "BOMBANANA!": demos and playtests often have no store art of their own.
const baseGameName = (name) => name.replace(/\s*[-–:(]?\s*\b(demo|playtest|prologue|beta|trial)\b\)?.*$/i, '').trim();

const looksLikeImage = (b) =>
  (b[0] === 0xff && b[1] === 0xd8) || // JPEG
  b.subarray(0, 4).toString('hex') === '89504e47' || // PNG
  (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP');

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  // Some CDNs (Riot) send images as "binary/octet-stream": trust the bytes, not just the header.
  if (!/^image\//.test(res.headers.get('content-type') || '') && !looksLikeImage(buf)) return false;
  fs.writeFileSync(dest, buf);
  return true;
}

// Downloads art for a game into dir; returns the fields to merge into the game record.
async function fetchArt(name, id, dir, { appid, steamName, epicNamespace, epicItemId, riotProduct, strict = false, skipSteam = false } = {}) {
  let info = null;
  let source = 'epic';
  // Installed Epic games: the launcher's catalog has their exact art.
  if (epicNamespace || epicItemId) info = epicInfo(name, { itemId: epicItemId, namespace: epicNamespace });
  // Riot games: the official art the Riot Client shows in its library.
  if (!info && riotProduct) {
    source = 'riot';
    try {
      info = await riotInfo(riotProduct);
    } catch {}
  }
  // Epic's catalog rarely has a transparent logo: borrow Steam's when it is clearly the same game.
  if (info && !info.urls.logo.length) {
    try {
      const item = await findSteamApp(name);
      if (item && similarity(name, item.name) >= 0.8) info.urls.logo = steamInfo(item).urls.logo;
    } catch {}
  }
  if (!info && !skipSteam) {
    source = 'steam';
    try {
      if (appid) {
        const [item] = await steamItems([appid]);
        if (item && item.assets && item.assets.library_capsule) info = steamInfo({ ...item, name: steamName || item.name });
      }
      if (!info) {
        const item = await findSteamApp(appid ? baseGameName(steamName || name) : name, { strict });
        if (item) info = { ...steamInfo(item), ...(appid ? { steamName: steamName || name, steamAppId: appid } : {}) };
      }
    } catch {}
  }
  if (!info) {
    source = 'epic';
    info = epicInfo(baseGameName(name));
  }
  if (!info) {
    source = 'wikipedia';
    try {
      info = await wikipediaCover(name);
    } catch {}
  }
  if (!info) return null;
  if (garbled(info.description)) info.description = await cleanDescription(info.steamName || name);

  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  const out = { coverSource: source };
  const file = (kind, ext) => path.join(dir, `${id}-${kind}-${stamp}.${ext}`);

  // Each kind has candidates in order of preference; keep the first one that downloads.
  const first = async (urls, kind, ext) => {
    for (const u of (urls || []).filter(Boolean)) {
      const p = file(kind, /\.svg(\?|$)/i.test(u) ? 'svg' : ext);
      if (await download(u, p).catch(() => false)) return p;
    }
    return undefined;
  };
  out.cover = await first(info.urls.cover, 'cover', 'jpg');
  if (out.cover && info.landscapeCover) cropPortrait(out.cover);
  out.hero = await first(info.urls.hero, 'hero', 'jpg');
  out.logo = await first(info.urls.logo, 'logo', 'png');
  for (const k of ['cover', 'hero', 'logo']) if (!out[k]) delete out[k];
  if (!out.cover) return null;
  // Only now drop the previous auto-downloaded art, so a failed fetch never leaves the game without images.
  const keep = new Set([out.cover, out.hero, out.logo].filter(Boolean).map((p) => path.basename(p)));
  for (const f of fs.readdirSync(dir)) if (f.startsWith(`${id}-`) && !keep.has(f)) fs.rmSync(path.join(dir, f), { force: true });
  for (const k of ['steamAppId', 'steamName', 'partialMatch', 'description', 'developer', 'publisher', 'year']) {
    if (info[k] !== undefined) out[k] = info[k];
  }
  return out;
}

module.exports = { fetchArt, steamSearch, similarity, garbled, cleanDescription };
