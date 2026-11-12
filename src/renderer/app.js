const $ = (sel) => document.querySelector(sel);

const state = {
  games: new Map(),
  settings: {},
  view: 'all',
  query: '',
  selectedId: null,
  artPending: 0,
};

const VIEWS = [
  { id: 'all', label: 'Bibliothèque', icon: 'library' },
  { id: 'favorites', label: 'Favoris', icon: 'heart' },
  { id: 'recent', label: 'Récemment joués', icon: 'clock' },
  { id: 'new', label: 'Jamais lancés', icon: 'sparkle' },
  { id: 'hidden', label: 'Masqués', icon: 'eyeOff' },
];

const SORTS = [
  { id: 'name', label: 'A–Z' },
  { id: 'recent', label: 'Récents' },
  { id: 'playtime', label: 'Temps de jeu' },
  { id: 'added', label: 'Ajoutés' },
];

const ACCENTS = [
  ['#8b7bff', '#d36bff'],
  ['#4f8cff', '#38d6ff'],
  ['#2fd38a', '#a3f05b'],
  ['#ff7a45', '#ffc23d'],
  ['#ff4f7b', '#ff8f6b'],
  ['#e6e8ef', '#9aa3b8'],
];

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const media = (p) => (p ? `media://local/${encodeURIComponent(p)}` : '');

function title(g) {
  if (g.custom && g.custom.name) return g.name;
  return g.steamName && !g.partialMatch ? g.steamName : g.name;
}

function hue(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function fmtPlaytime(sec) {
  if (!sec) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h === 0) return `${Math.max(1, m)} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

function fmtLastPlayed(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  const today = new Date();
  const days = Math.floor((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days} jours`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function applyAccent(accent) {
  const pair = ACCENTS.find((p) => p[0] === accent) || ACCENTS[0];
  const root = document.documentElement.style;
  root.setProperty('--accent', pair[0]);
  root.setProperty('--accent-2', pair[1]);
  root.setProperty('--accent-rgb', hexToRgb(pair[0]));
}

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    el.removeAttribute('data-icon');
  });
}

// Average colour of a cover, used for the hover glow.
const glowCache = new Map();
function computeGlow(img, id) {
  if (glowCache.has(id)) return glowCache.get(id);
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 12;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 12, 12);
    const d = ctx.getImageData(0, 0, 12, 12).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2]);
      const min = Math.min(d[i], d[i + 1], d[i + 2]);
      const w = 1 + (max - min) / 40; // favour saturated pixels
      r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
    }
    const rgb = `${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)}`;
    glowCache.set(id, rgb);
    return rgb;
  } catch {
    return null;
  }
}

// ---------- data views ----------

function visibleGames() {
  const q = state.query.trim().toLowerCase();
  let list = [...state.games.values()];
  if (state.view === 'hidden') list = list.filter((g) => g.hidden);
  else list = list.filter((g) => !g.hidden);
  if (state.view === 'favorites') list = list.filter((g) => g.favorite);
  if (state.view === 'recent') list = list.filter((g) => g.lastPlayed);
  if (state.view === 'new') list = list.filter((g) => !g.lastPlayed);
  if (q) list = list.filter((g) => title(g).toLowerCase().includes(q) || g.name.toLowerCase().includes(q));

  const sort = state.view === 'recent' ? 'recent' : state.settings.sort;
  const byName = (a, b) => title(a).localeCompare(title(b), 'fr', { sensitivity: 'base' });
  list.sort((a, b) => {
    if (sort === 'recent') return (b.lastPlayed || 0) - (a.lastPlayed || 0) || byName(a, b);
    if (sort === 'playtime') return (b.playtime || 0) - (a.playtime || 0) || byName(a, b);
    if (sort === 'added') return (b.addedAt || 0) - (a.addedAt || 0) || byName(a, b);
    return byName(a, b);
  });
  return list;
}

function pickFeatured() {
  const list = [...state.games.values()].filter((g) => !g.hidden);
  const running = list.find((g) => g.running);
  if (running) return running;
  const recent = list.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0];
  return recent || list.find((g) => g.favorite && g.hero) || list.find((g) => g.hero) || list[0];
}

// ---------- rendering ----------

function renderNav() {
  const all = [...state.games.values()];
  const counts = {
    all: all.filter((g) => !g.hidden).length,
    favorites: all.filter((g) => g.favorite && !g.hidden).length,
    recent: all.filter((g) => g.lastPlayed && !g.hidden).length,
    new: all.filter((g) => !g.lastPlayed && !g.hidden).length,
    hidden: all.filter((g) => g.hidden).length,
  };
  $('#nav').innerHTML = VIEWS.filter((v) => v.id !== 'hidden' || counts.hidden)
    .map(
      (v) => `<button class="nav-item ${state.view === v.id ? 'active' : ''}" data-view="${v.id}">
        ${icon(v.icon)}<span>${v.label}</span><span class="count">${counts[v.id]}</span></button>`
    )
    .join('');

  const favs = all.filter((g) => g.favorite && !g.hidden).sort((a, b) => title(a).localeCompare(title(b), 'fr'));
  $('#favList').innerHTML = favs.length
    ? favs
        .map(
          (g) => `<button class="fav-item" data-id="${g.id}" title="${esc(title(g))}">
            ${g.cover ? `<img src="${media(g.cover)}" alt="" loading="lazy">` : '<div class="fav-ph"></div>'}
            <span>${esc(title(g))}</span>${g.running ? '<i class="dot"></i>' : ''}</button>`
        )
        .join('')
    : `<div class="fav-empty">Clique sur ${icon('heart', 'inline')} pour épingler tes jeux préférés ici.</div>`;
  $('#favList').querySelectorAll('.fav-empty .ic').forEach((i) => (i.style.cssText = 'display:inline;width:13px;height:13px;vertical-align:-2px'));

  const total = all.reduce((s, g) => s + (g.playtime || 0), 0);
  $('#sideStats').innerHTML = `
    <div class="stat"><b>${counts.all}</b><small>Jeux</small></div>
    <div class="stat"><b>${total ? Math.round(total / 3600) + ' h' : '0 h'}</b><small>Jouées</small></div>`;
}

let ambientFlip = false;
let lastAmbient = null;
function setAmbient(src) {
  if (src === lastAmbient) return;
  lastAmbient = src;
  const [a, b] = ambientFlip ? ['#ambientA', '#ambientB'] : ['#ambientB', '#ambientA'];
  ambientFlip = !ambientFlip;
  const next = $(a);
  next.style.backgroundImage = src ? `url("${src}")` : 'none';
  next.classList.add('on');
  $(b).classList.remove('on');
}

function renderHero() {
  const g = state.games.get(state.selectedId) || pickFeatured();
  const hero = $('#hero');
  if (!g) {
    hero.innerHTML = '';
    setAmbient(null);
    return;
  }
  state.selectedId = g.id;
  const bg = media(g.hero || g.cover);
  const meta = [
    g.developer && `<span>${esc(g.developer.split(',')[0])}</span>`,
    g.year && `<span>${g.year}</span>`,
    `<span>${icon('clock')}${fmtPlaytime(g.playtime) || 'Jamais joué'}</span>`,
    g.lastPlayed && `<span>${icon('gamepad')}${fmtLastPlayed(g.lastPlayed)}</span>`,
  ].filter(Boolean);

  const eyebrow = g.running
    ? '<span class="pill live">En cours</span>'
    : `<span class="pill">${g.lastPlayed ? 'Continuer' : 'À découvrir'}</span>`;

  hero.innerHTML = `
    <div class="hero-art ${g.hero ? '' : 'blurred'}" style="background-image:url('${bg}')"></div>
    <div class="hero-content" key="${g.id}">
      <div class="hero-eyebrow">${eyebrow}</div>
      ${
        g.logo
          ? `<img class="hero-logo" src="${media(g.logo)}" alt="${esc(title(g))}">`
          : `<h1 class="hero-title">${esc(title(g))}</h1>`
      }
      <div class="hero-meta">${meta.join('<span style="opacity:.35">•</span>')}</div>
      ${g.description ? `<p class="hero-desc">${esc(g.description)}</p>` : ''}
      <div class="hero-actions">
        <button class="btn-play ${g.running ? 'running' : ''}" data-act="play">${icon(g.running ? 'gamepad' : 'play')}${g.running ? 'En cours…' : 'Jouer'}</button>
        <button class="btn-icon ${g.favorite ? 'fav-on' : ''}" data-act="fav" title="${g.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${icon(g.favorite ? 'heartFill' : 'heart')}</button>
        <button class="btn-icon" data-act="folder" title="Ouvrir le dossier">${icon('folder')}</button>
        <button class="btn-icon" data-act="more" title="Plus d’options">${icon('more')}</button>
      </div>
    </div>
    ${g.hero && g.cover ? `<div class="hero-cover"><img src="${media(g.cover)}" alt=""></div>` : ''}`;

  const logo = hero.querySelector('.hero-logo');
  if (logo) logo.addEventListener('error', () => (logo.outerHTML = `<h1 class="hero-title">${esc(title(g))}</h1>`), { once: true });

  const art = hero.querySelector('.hero-art');
  const img = new Image();
  img.onload = () => art.classList.add('on');
  img.onerror = () => art.classList.add('on');
  img.src = bg;
  setAmbient(media(g.cover || g.hero));
}

function cardHtml(g, i) {
  const t = title(g);
  const sub = g.running
    ? '<span style="color:var(--success)">En cours</span>'
    : fmtPlaytime(g.playtime)
      ? `${fmtPlaytime(g.playtime)}${g.lastPlayed ? ' · ' + fmtLastPlayed(g.lastPlayed) : ''}`
      : 'Jamais joué';
  const art = g.cover
    ? `<img src="${media(g.cover)}" alt="" loading="lazy" crossorigin="anonymous">`
    : `<div class="placeholder ${g.artFetched ? '' : 'loading'}" style="--h:${hue(t)}">${icon('gamepad')}${esc(t)}</div>`;
  return `<div class="card ${g.id === state.selectedId ? 'selected' : ''}" data-id="${g.id}" tabindex="0" style="animation-delay:${Math.min(i, 24) * 22}ms${glowCache.has(g.id) ? `;--glow:${glowCache.get(g.id)}` : ''}">
    <div class="card-art">${art}
      ${g.running ? '<span class="card-badge">En cours</span>' : ''}
      <button class="card-fav ${g.favorite ? 'on' : ''}" data-act="fav" title="Favori">${icon(g.favorite ? 'heartFill' : 'heart')}</button>
      <button class="card-play" data-act="play" title="Jouer">${icon('play')}</button>
    </div>
    <div class="card-info"><div class="card-title" title="${esc(t)}">${esc(t)}</div><div class="card-sub">${sub}</div></div>
  </div>`;
}

function renderGrid({ animate = true } = {}) {
  const list = visibleGames();
  const grid = $('#grid');
  grid.innerHTML = list.map(cardHtml).join('');
  if (!animate) grid.querySelectorAll('.card').forEach((c) => (c.style.animation = 'none'));
  grid.querySelectorAll('.card img').forEach((img) => {
    const card = img.closest('.card');
    const setGlow = () => {
      const rgb = computeGlow(img, card.dataset.id);
      if (rgb) card.style.setProperty('--glow', rgb);
    };
    img.complete && img.naturalWidth ? setGlow() : img.addEventListener('load', setGlow, { once: true });
  });

  const view = VIEWS.find((v) => v.id === state.view);
  $('#libTitle').textContent = state.query ? 'Résultats' : view.label;
  $('#libCount').textContent = list.length;
  const empty = $('#empty');
  empty.hidden = list.length > 0;
  if (!list.length) {
    empty.innerHTML = state.query
      ? `${icon('search')}<h3>Aucun jeu trouvé</h3><div>Rien ne correspond à « ${esc(state.query)} ».</div>`
      : state.view === 'favorites'
        ? `${icon('heart')}<h3>Pas encore de favoris</h3><div>Survole une cover et clique sur le cœur.</div>`
        : `${icon('gamepad')}<h3>Rien ici pour l’instant</h3><div>Vérifie tes dossiers de jeux dans les paramètres.</div>`;
  }
}

function renderSort() {
  $('#sortSeg').innerHTML = SORTS.map(
    (s) => `<button data-sort="${s.id}" class="${state.settings.sort === s.id ? 'active' : ''}">${s.label}</button>`
  ).join('');
  $('#sortSeg').style.display = state.view === 'recent' ? 'none' : '';
}

function renderAll(opts) {
  renderNav();
  renderHero();
  renderSort();
  renderGrid(opts);
}

// Re-render only what one game affects, without replaying grid animations.
function refreshGame(g) {
  state.games.set(g.id, g);
  renderNav();
  if (g.id === state.selectedId) renderHero();
  const card = document.querySelector(`.card[data-id="${g.id}"]`);
  const shouldShow = visibleGames().some((x) => x.id === g.id);
  if (card && shouldShow) {
    const tmp = document.createElement('div');
    tmp.innerHTML = cardHtml(g, 0);
    const fresh = tmp.firstElementChild;
    fresh.style.animation = 'none';
    card.replaceWith(fresh);
    const img = fresh.querySelector('img');
    if (img) img.addEventListener('load', () => { glowCache.delete(g.id); const rgb = computeGlow(img, g.id); if (rgb) fresh.style.setProperty('--glow', rgb); }, { once: true });
  } else if (!!card !== shouldShow) {
    renderGrid({ animate: false });
  }
}

// ---------- actions ----------

function select(id, { scroll = true } = {}) {
  state.selectedId = id;
  document.querySelectorAll('.card.selected').forEach((c) => c.classList.remove('selected'));
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (card) card.classList.add('selected');
  renderHero();
  if (scroll) $('#scroll').scrollTo({ top: 0, behavior: 'smooth' });
}

async function launch(id) {
  const g = state.games.get(id);
  if (!g) return;
  if (g.running) return toast({ text: `${title(g)} est déjà lancé`, game: g });
  const res = await api.launch(id);
  if (!res.ok) return toast({ type: 'error', title: 'Lancement impossible', text: res.error });
  toast({ title: 'Lancement…', text: title(g), game: g });
}

async function toggleFav(id) {
  const g = state.games.get(id);
  refreshGame(await api.updateGame(id, { favorite: !g.favorite }));
}

async function toggleHidden(id) {
  const g = state.games.get(id);
  const updated = await api.updateGame(id, { hidden: !g.hidden });
  state.games.set(id, updated);
  if (updated.hidden && state.selectedId === id) state.selectedId = null;
  toast({ text: updated.hidden ? `${title(g)} est masqué` : `${title(g)} est de nouveau visible` });
  renderAll({ animate: false });
}

function setView(view) {
  state.view = view;
  renderNav();
  renderSort();
  renderGrid();
}

// ---------- context menu ----------

function openMenu(id, x, y) {
  const g = state.games.get(id);
  const menu = $('#menu');
  menu.innerHTML = `
    <div class="menu-head">${esc(title(g))}</div>
    <button data-m="play">${icon('play')}Jouer</button>
    ${g.running ? `<button data-m="stop" class="danger">${icon('stop')}Forcer l’arrêt</button>` : ''}
    <button data-m="fav">${icon(g.favorite ? 'heartFill' : 'heart')}${g.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}</button>
    <hr>
    <button data-m="edit">${icon('edit')}Modifier…</button>
    <button data-m="folder">${icon('folder')}Ouvrir le dossier</button>
    <button data-m="art">${icon('refresh')}Re-télécharger les images</button>
    <hr>
    <button data-m="hide">${icon(g.hidden ? 'eye' : 'eyeOff')}${g.hidden ? 'Afficher dans la bibliothèque' : 'Masquer'}</button>`;
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  menu.onclick = (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    closeMenu();
    ({
      play: () => launch(id),
      stop: () => api.stop(id),
      fav: () => toggleFav(id),
      edit: () => openEdit(id),
      folder: () => api.openFolder(id),
      art: () => { api.refetchArt(id); toast({ text: `Recherche des images pour ${title(g)}…` }); },
      hide: () => toggleHidden(id),
    })[b.dataset.m]();
  };
}

function closeMenu() {
  $('#menu').hidden = true;
}

// ---------- modals ----------

function openModal(html, onMount) {
  const modal = $('#modal');
  $('#modalBody').innerHTML = html;
  modal.hidden = false;
  modal.onclick = (e) => {
    if (e.target === modal || e.target.closest('[data-close]')) closeModal();
  };
  onMount && onMount($('#modalBody'));
}

function closeModal() {
  $('#modal').hidden = true;
  $('#modalBody').innerHTML = '';
}

function openEdit(id) {
  const g = state.games.get(id);
  const candidates = [...new Set([g.exe, ...(g.candidates || [])])];
  openModal(
    `<div class="modal-head"><h3>Modifier le jeu</h3><button class="close-x" data-close>${icon('x')}</button></div>
    <div class="modal-body">
      <div class="art-edit">
        <div class="art-thumb" id="eThumb">${g.cover ? `<img src="${media(g.cover)}">` : `<div class="placeholder" style="--h:${hue(title(g))}">${esc(title(g))}</div>`}</div>
        <div class="art-side">
          <div class="field" style="margin:0"><label>Nom affiché</label><input class="input" id="eName" value="${esc(title(g))}"></div>
          <div class="row">
            <button class="btn small" id="eCover">${icon('image')}Cover locale…</button>
            <button class="btn small" id="eHero">${icon('image')}Fond local…</button>
          </div>
          <div class="field" style="margin:4px 0 0"><label>Chercher les images sur Steam</label>
            <div class="row"><input class="input" id="eSteamQ" value="${esc(title(g))}" placeholder="Nom du jeu sur Steam"><button class="btn" id="eSteamGo">${icon('search')}Chercher</button></div>
          </div>
          <div class="steam-results" id="eSteam"></div>
        </div>
      </div>
      <div class="field" style="margin-top:20px"><label>Exécutable</label>
        <div class="row">
          <select class="select" id="eExe">${candidates.map((c) => `<option value="${esc(c)}" ${c === g.exe ? 'selected' : ''}>${esc(c.replace(g.folder, '…'))}</option>`).join('')}</select>
          <button class="btn" id="eBrowse">${icon('folder')}Parcourir…</button>
        </div>
      </div>
      <div class="field"><label>Arguments de lancement</label><input class="input" id="eArgs" value="${esc(g.args || '')}" placeholder="ex : -windowed -skipintro"></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="eSave">${icon('check')}Enregistrer</button></div>`,
    (root) => {
      const steamGo = async () => {
        const box = root.querySelector('#eSteam');
        box.innerHTML = '<div class="row" style="color:var(--muted);font-size:12.5px"><span class="spinner"></span>Recherche…</div>';
        const results = await api.steamSearch(root.querySelector('#eSteamQ').value);
        box.innerHTML = results.length
          ? results.map((r) => `<button class="steam-result" data-appid="${r.appid}" data-name="${esc(r.name)}"><img src="${esc(r.image)}" alt=""><span>${esc(r.name)}</span></button>`).join('')
          : '<div style="color:var(--muted);font-size:12.5px">Aucun résultat.</div>';
      };
      root.querySelector('#eSteamGo').onclick = steamGo;
      root.querySelector('#eSteamQ').onkeydown = (e) => e.key === 'Enter' && steamGo();
      root.querySelector('#eSteam').onclick = (e) => {
        const b = e.target.closest('.steam-result');
        if (!b) return;
        api.refetchArt(id, { appid: Number(b.dataset.appid), steamName: b.dataset.name });
        toast({ text: `Images de « ${b.dataset.name} » en cours de téléchargement…` });
        closeModal();
      };
      root.querySelector('#eCover').onclick = async () => {
        const u = await api.pickImage(id, 'cover');
        if (u) { refreshGame(u); root.querySelector('#eThumb').innerHTML = `<img src="${media(u.cover)}">`; }
      };
      root.querySelector('#eHero').onclick = async () => {
        const u = await api.pickImage(id, 'hero');
        if (u) { refreshGame(u); toast({ text: 'Image de fond mise à jour' }); }
      };
      root.querySelector('#eBrowse').onclick = async () => {
        const p = await api.pickExe(id);
        if (!p) return;
        const sel = root.querySelector('#eExe');
        sel.insertAdjacentHTML('afterbegin', `<option value="${esc(p)}">${esc(p)}</option>`);
        sel.value = p;
      };
      root.querySelector('#eSave').onclick = async () => {
        const name = root.querySelector('#eName').value.trim();
        const patch = { exe: root.querySelector('#eExe').value, args: root.querySelector('#eArgs').value.trim() };
        if (name && name !== title(g)) patch.name = name;
        refreshGame(await api.updateGame(id, patch));
        closeModal();
        toast({ text: 'Modifications enregistrées' });
      };
    }
  );
}

function openSettings() {
  const s = state.settings;
  const rootsHtml = () =>
    (s.roots.length ? s.roots : [])
      .map((r, i) => `<div class="list-row">${icon('folder')}<span>${esc(r)}</span><button data-rm="${i}" title="Retirer">${icon('trash')}</button></div>`)
      .join('') || '<div class="list-row"><span style="color:var(--muted)">Aucun dossier</span></div>';

  openModal(
    `<div class="modal-head"><h3>Paramètres</h3><button class="close-x" data-close>${icon('x')}</button></div>
    <div class="modal-body">
      <div class="field"><label>Dossiers de jeux</label>
        <div class="list-box" id="sRoots">${rootsHtml()}</div>
        <div class="row" style="margin-top:8px"><button class="btn small" id="sAddRoot">${icon('plus')}Ajouter un dossier</button><button class="btn small" id="sRescan">${icon('refresh')}Rescanner</button></div>
        <div class="hint">Chaque sous-dossier est considéré comme un jeu. L’exécutable principal est détecté automatiquement.</div>
      </div>
      <div class="field"><label>Dossiers ignorés</label>
        <input class="input" id="sExcluded" value="${esc(s.excluded.join(', '))}" placeholder="Séparés par des virgules">
      </div>
      <div class="field"><label>Couleur d’accent</label>
        <div class="swatches">${ACCENTS.map((p) => `<button class="swatch ${s.accent === p[0] ? 'active' : ''}" data-accent="${p[0]}" style="background:linear-gradient(135deg,${p[0]},${p[1]})"></button>`).join('')}</div>
      </div>
      <div class="field">
        <label class="toggle"><div><b>Réduire le launcher au lancement d’un jeu</b><small>Il réapparaît automatiquement quand tu quittes le jeu.</small></div>
          <span class="switch"><input type="checkbox" id="sMin" ${s.minimizeOnLaunch ? 'checked' : ''}><i></i></span></label>
      </div>
      <div class="field"><label>Images</label>
        <button class="btn small" id="sRefetch">${icon('steam')}Re-télécharger toutes les covers</button>
        <div class="hint">Les covers, fonds et logos viennent de Steam (Wikipedia en secours). Tes images personnalisées sont remplacées.</div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn primary" data-close>Terminé</button></div>`,
    (root) => {
      const save = async (patch) => {
        state.settings = await api.updateSettings(patch);
        Object.assign(s, state.settings);
      };
      root.querySelector('#sRoots').onclick = async (e) => {
        const b = e.target.closest('[data-rm]');
        if (!b) return;
        await save({ roots: s.roots.filter((_, i) => i !== Number(b.dataset.rm)) });
        root.querySelector('#sRoots').innerHTML = rootsHtml();
      };
      root.querySelector('#sAddRoot').onclick = async () => {
        const p = await api.pickRoot();
        if (!p || s.roots.includes(p)) return;
        await save({ roots: [...s.roots, p] });
        root.querySelector('#sRoots').innerHTML = rootsHtml();
      };
      root.querySelector('#sExcluded').onchange = (e) => save({ excluded: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) });
      root.querySelector('#sRescan').onclick = async () => {
        await save({ excluded: root.querySelector('#sExcluded').value.split(',').map((x) => x.trim()).filter(Boolean) });
        setGames(await api.rescan());
        toast({ text: `${state.games.size} jeux trouvés` });
      };
      root.querySelector('#sMin').onchange = (e) => save({ minimizeOnLaunch: e.target.checked });
      root.querySelectorAll('[data-accent]').forEach((b) =>
        (b.onclick = async () => {
          await save({ accent: b.dataset.accent });
          applyAccent(b.dataset.accent);
          root.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('active', x === b));
        })
      );
      root.querySelector('#sRefetch').onclick = () => {
        api.refetchAll();
        toast({ text: 'Téléchargement des images en cours…' });
      };
    }
  );
}

// ---------- toasts ----------

function toast({ type = 'info', title: t, text, game }) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const visual = game && game.cover ? `<img src="${media(game.cover)}" alt="">` : `<div class="t-ic">${icon(type === 'error' ? 'x' : 'sparkle')}</div>`;
  el.innerHTML = `${visual}<div>${t ? `<b>${esc(t)}</b>` : ''}<small>${esc(text)}</small></div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, type === 'error' ? 6000 : 3200);
}

// ---------- events ----------

function setGames(list) {
  state.games = new Map(list.map((g) => [g.id, g]));
  if (state.selectedId && !state.games.has(state.selectedId)) state.selectedId = null;
  renderAll();
}

function bindEvents() {
  $('#nav').onclick = (e) => {
    const b = e.target.closest('[data-view]');
    if (b) setView(b.dataset.view);
  };
  $('#favList').onclick = (e) => {
    const b = e.target.closest('[data-id]');
    if (b) select(b.dataset.id);
  };
  $('#favList').ondblclick = (e) => {
    const b = e.target.closest('[data-id]');
    if (b) launch(b.dataset.id);
  };

  $('#sortSeg').onclick = async (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    state.settings = await api.updateSettings({ sort: b.dataset.sort });
    renderSort();
    renderGrid();
  };

  const size = $('#cardSize');
  size.oninput = () => document.documentElement.style.setProperty('--card', size.value + 'px');
  size.onchange = () => api.updateSettings({ cardSize: Number(size.value) });

  const search = $('#search');
  search.oninput = () => {
    state.query = search.value;
    renderGrid({ animate: false });
  };

  const grid = $('#grid');
  grid.onclick = (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'play') return launch(card.dataset.id);
    if (act && act.dataset.act === 'fav') return toggleFav(card.dataset.id);
    select(card.dataset.id);
  };
  grid.ondblclick = (e) => {
    const card = e.target.closest('.card');
    if (card && !e.target.closest('[data-act]')) launch(card.dataset.id);
  };
  grid.oncontextmenu = (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    openMenu(card.dataset.id, e.clientX, e.clientY);
  };

  $('#hero').onclick = (e) => {
    const b = e.target.closest('[data-act]');
    const id = state.selectedId;
    if (!b || !id) return;
    if (b.dataset.act === 'play') launch(id);
    if (b.dataset.act === 'fav') toggleFav(id);
    if (b.dataset.act === 'folder') api.openFolder(id);
    if (b.dataset.act === 'more') {
      const r = b.getBoundingClientRect();
      openMenu(id, r.left, r.bottom + 8);
    }
  };

  $('#scroll').addEventListener('scroll', () => $('.topbar').classList.toggle('solid', $('#scroll').scrollTop > 40), { passive: true });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#menu') && !e.target.closest('[data-act="more"]')) closeMenu();
  });
  window.addEventListener('blur', closeMenu);

  $('#btnSettings').onclick = openSettings;
  $('#btnAdd').onclick = async () => {
    const g = await api.addManual();
    if (g) {
      state.games.set(g.id, g);
      renderAll({ animate: false });
      select(g.id);
      toast({ text: `${title(g)} ajouté à la bibliothèque` });
    }
  };

  $('#winMin').onclick = api.win.minimize;
  $('#winMax').onclick = api.win.maximize;
  $('#winClose').onclick = api.win.close;

  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (e.key === 'Escape') {
      if (!$('#modal').hidden) return closeModal();
      if (!$('#menu').hidden) return closeMenu();
      if (state.query) { search.value = ''; state.query = ''; renderGrid({ animate: false }); }
      search.blur();
      return;
    }
    if ((e.ctrlKey && e.key.toLowerCase() === 'f') || (!typing && e.key === '/')) {
      e.preventDefault();
      search.focus();
      search.select();
      return;
    }
    if (typing || !$('#modal').hidden) {
      if (e.key === 'Enter' && document.activeElement === search) {
        const first = visibleGames()[0];
        if (first) select(first.id);
      }
      return;
    }
    if (e.key === 'Enter' && state.selectedId) return launch(state.selectedId);
    if (/^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
      e.preventDefault();
      const list = visibleGames();
      if (!list.length) return;
      const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      let i = list.findIndex((g) => g.id === state.selectedId);
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
      i = i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + step));
      select(list[i].id, { scroll: false });
      document.querySelector(`.card[data-id="${list[i].id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    // Type anywhere to search.
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) search.focus();
  });

  api.onLibraryChanged(setGames);
  api.onGameUpdated((g) => g && refreshGame(g));
  api.onArtProgress(({ pending }) => {
    $('#artProgress').hidden = pending === 0;
    $('#artProgressText').textContent = `Téléchargement des covers… ${pending}`;
  });
  api.onSessionEnded(({ id, seconds }) => {
    const g = state.games.get(id);
    if (g) toast({ title: 'Session terminée', text: `${title(g)} · ${fmtPlaytime(seconds) || 'moins d’une minute'}`, game: g });
  });
  api.onToast(toast);
  api.onWindowState((max) => ($('#winMax').title = max ? 'Restaurer' : 'Agrandir'));
}

async function init() {
  hydrateIcons();
  const { games, settings } = await api.getLibrary();
  state.settings = settings;
  applyAccent(settings.accent);
  $('#cardSize').value = settings.cardSize;
  document.documentElement.style.setProperty('--card', settings.cardSize + 'px');
  bindEvents();
  setGames(games);
}

init();
