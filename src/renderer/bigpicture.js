// Mode manette: a full-screen, couch-friendly view driven by a gamepad (or the keyboard).

const bp = { open: false, shelf: 0, index: 0, shelves: [], raf: 0, held: {}, prevButtons: [], pad: null, launching: null };

// Standard gamepad mapping (same indexes for Xbox and PlayStation pads).
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16 };

// What a controller is, from the id the browser reports (Sony's USB vendor id is 054c).
function padKind(pad) {
  return /054c|playstation|dualsense|dualshock|wireless controller/i.test(pad.id) ? 'ps' : 'xbox';
}

// PlayStation face buttons: cross, circle, triangle, square.
const PS_SHAPES = {
  a: '<path d="M8 8l8 8M16 8l-8 8"/>',
  b: '<circle cx="12" cy="12" r="4.6"/>',
  y: '<path d="M12 7.2l5 8.6H7z"/>',
  x: '<rect x="7.6" y="7.6" width="8.8" height="8.8" rx=".6"/>',
};

// Glyph for a face button ('a' | 'b' | 'y') or a shoulder ('lb' | 'rb'), matching the pad in use.
function padGlyph(btn) {
  const kind = bp.pad || 'keyboard';
  if (btn === 'lb' || btn === 'rb') {
    const label = { ps: { lb: 'L1', rb: 'R1' }, xbox: { lb: 'LB', rb: 'RB' }, keyboard: { lb: '↑', rb: '↓' } }[kind][btn];
    return `<span class="bp-key">${label}</span>`;
  }
  if (kind === 'ps') return `<i class="bp-btn ps ${btn}"><svg viewBox="0 0 24 24">${PS_SHAPES[btn]}</svg></i>`;
  if (kind === 'xbox') return `<i class="bp-btn xb ${btn}">${btn.toUpperCase()}</i>`;
  return `<i class="bp-btn kb">${{ a: 'Entrée', b: 'Échap', y: 'F' }[btn]}</i>`;
}

function bpLegend() {
  return `<span>${padGlyph('a')}Jouer</span><span>${padGlyph('y')}Favori</span><span>${padGlyph('b')}Quitter</span>`;
}

// Switch glyphs when another kind of controller is used.
function setPadKind(kind) {
  if (bp.pad === kind) return;
  bp.pad = kind;
  if (!bp.open) return;
  const legend = $('#bpLegend');
  if (legend) legend.innerHTML = bpLegend();
  const keys = $('#bp').querySelectorAll('.bp-tabs > .bp-key');
  if (keys.length === 2) { keys[0].outerHTML = padGlyph('lb'); keys[1].outerHTML = padGlyph('rb'); }
}

function bpShelves() {
  const games = [...state.games.values()].filter((g) => !g.hidden);
  const byName = (a, b) => title(a).localeCompare(title(b), 'fr', { sensitivity: 'base' });
  const from = (source) => games.filter((g) => (g.source || 'local') === source).sort(byName);
  const shelves = [
    { label: 'Favoris', games: games.filter((g) => g.favorite).sort(byName) },
    { label: 'Récents', games: games.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed) },
    { label: 'Mes jeux', games: from('local') },
    { label: 'Steam', games: from('steam') },
    { label: 'Epic Games', games: from('epic') },
    ...allCollections().map((c) => ({ label: c, games: games.filter((g) => (g.collections || []).includes(c)).sort(byName) })),
    { label: 'Tous les jeux', games: [...games].sort(byName) },
  ];
  return shelves.filter((s) => s.games.length);
}

// Always read the live record: favourites/running state change while the mode is open.
function bpGame() {
  const g = bp.shelves[bp.shelf] && bp.shelves[bp.shelf].games[bp.index];
  return g && (state.games.get(g.id) || g);
}

function bpClock() {
  const el = $('#bpClock');
  if (el) el.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function bpCardArt(g) {
  // Eager on purpose: lazy images inside the horizontal row could stay blank until a scroll.
  return g.cover ? `<img src="${media(g.cover)}" alt="">` : `<div class="placeholder" style="--h:${hue(title(g))}">${esc(title(g))}</div>`;
}

function renderBP() {
  bp.shelves = bpShelves();
  bp.shelf = Math.min(bp.shelf, Math.max(0, bp.shelves.length - 1));
  const shelf = bp.shelves[bp.shelf];
  bp.index = shelf ? Math.min(bp.index, shelf.games.length - 1) : 0;
  $('#bp').innerHTML = `
    <div class="bp-art" id="bpArt"></div>
    <div class="bp-poster" id="bpPoster"></div>
    <header class="bp-top">
      <div class="bp-brand">${$('.brand-mark').outerHTML}<span>Shallow</span></div>
      <nav class="bp-tabs">${padGlyph('lb')}${bp.shelves.map((s, i) => `<button class="${i === bp.shelf ? 'on' : ''}" data-shelf="${i}">${esc(s.label)}</button>`).join('')}${padGlyph('rb')}</nav>
      <div class="bp-clock" id="bpClock"></div>
    </header>
    <section class="bp-info" id="bpInfo"></section>
    <div class="bp-row" id="bpRow">${
      shelf
        ? shelf.games
            .map((g, i) => `<button class="bp-card ${i === bp.index ? 'on' : ''}" data-i="${i}" data-id="${g.id}">${bpCardArt(g)}${g.running ? '<span class="card-badge">En cours</span>' : ''}</button>`)
            .join('')
        : '<div class="bp-empty">Aucun jeu à afficher.</div>'
    }</div>
    <footer class="bp-legend" id="bpLegend">${bpLegend()}</footer>`;
  bpClock();
  bpFocus(false);
}

// Centre the focused card by scrolling the row itself: scrollIntoView would also scroll
// the full-screen container and shift the whole interface sideways.
function bpCenterCard(smooth) {
  const row = $('#bpRow');
  const card = row && row.querySelector('.bp-card.on');
  if (!card) return;
  const left = card.offsetLeft - (row.clientWidth - card.offsetWidth) / 2;
  row.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' });
}

// Backdrop colour for games without a background image, from the cover's dominant colour.
function bpTint(g) {
  const art = $('#bpArt');
  const apply = (rgb) => (rgb ? art.style.setProperty('--tint', rgb) : art.style.removeProperty('--tint')); // falls back to the accent
  if (glowCache.has(g.id)) return apply(glowCache.get(g.id));
  apply(null);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => bpGame() && bpGame().id === g.id && apply(computeGlow(img, g.id));
  img.src = media(g.cover);
}

// Update the focused card and the info panel without rebuilding the row.
function bpFocus(smooth = true) {
  const g = bpGame();
  $('#bpRow').querySelectorAll('.bp-card').forEach((c, i) => c.classList.toggle('on', i === bp.index));
  bpCenterCard(smooth);
  if (!g) return;
  const art = $('#bpArt');
  const poster = $('#bpPoster');
  // With a real background we show it sharp; with only a cover we show the cover itself on a tinted
  // backdrop rather than a blurry stretched copy of it.
  const key = g.hero ? `hero:${g.hero}` : `poster:${g.cover || g.id}`;
  if (art.dataset.key !== key) {
    art.dataset.key = key;
    art.classList.toggle('tinted', !g.hero);
    art.style.backgroundImage = g.hero ? `url("${media(g.hero)}")` : '';
    if (!g.hero && g.cover) bpTint(g);
    poster.innerHTML = !g.hero && g.cover ? `<img src="${media(g.cover)}" alt="">` : '';
    for (const el of [art, poster]) {
      el.classList.remove('on');
      void el.offsetWidth;
      el.classList.add('on');
    }
  }
  const meta = [
    g.running ? '<span class="live">En cours</span>' : esc(fmtPlaytime(g.playtime) ? `${fmtPlaytime(g.playtime)} de jeu` : 'Jamais joué'),
    g.lastPlayed && esc(fmtLastPlayed(g.lastPlayed)),
    g.status && esc(statusLabel(g.status)),
  ].filter(Boolean);
  $('#bpInfo').innerHTML = `
    ${g.logo ? `<img class="bp-logo" src="${media(g.logo)}" alt="${esc(title(g))}">` : `<h1>${esc(title(g))}</h1>`}
    <div class="bp-meta">${g.favorite ? `<span class="bp-fav">${icon('heartFill')}</span>` : ''}${meta.join('<i>•</i>')}</div>`;
  const logo = $('#bpInfo').querySelector('.bp-logo');
  if (logo) logo.onerror = () => (logo.outerHTML = `<h1>${esc(title(g))}</h1>`);
}

// The mouse pointer is hidden while you use the pad/keyboard; moving the mouse shows it for a moment.
function bpHideCursor() {
  clearTimeout(bp.cursorTimer);
  $('#bp').classList.add('no-cursor');
}

function bpShowCursor(e) {
  if (!bp.open) return;
  // Going full screen fires mousemove without the mouse moving: only a real move shows the pointer.
  const last = bp.mouse;
  bp.mouse = { x: e.screenX, y: e.screenY };
  if (!last || Math.abs(e.screenX - last.x) + Math.abs(e.screenY - last.y) < 4) return;
  if (performance.now() < bp.ignoreMouseUntil) return; // the window is still switching to full screen
  $('#bp').classList.remove('no-cursor');
  clearTimeout(bp.cursorTimer);
  bp.cursorTimer = setTimeout(bpHideCursor, 2000);
}

// Redraw one game's card (cover + "En cours" badge) from its live record.
function bpRefreshCard(id) {
  if (!bp.open) return;
  const g = state.games.get(id);
  const card = $('#bpRow') && $('#bpRow').querySelector(`.bp-card[data-id="${CSS.escape(id)}"]`);
  if (g && card) card.innerHTML = `${bpCardArt(g)}${g.running ? '<span class="card-badge">En cours</span>' : ''}`;
  const focused = bpGame();
  if (focused && focused.id === id) bpFocus(false);
}

function bpMove(dx) {
  const shelf = bp.shelves[bp.shelf];
  if (!shelf) return;
  const next = Math.max(0, Math.min(shelf.games.length - 1, bp.index + dx));
  if (next !== bp.index) { bp.index = next; bpFocus(); }
}

function bpShelf(d) {
  if (bp.shelves.length < 2) return;
  bp.shelf = (bp.shelf + d + bp.shelves.length) % bp.shelves.length;
  bp.index = 0;
  renderBP();
}

// Launch animation: the focused cover flies to the centre, grows and glows while the game starts.
async function bpLaunch(g) {
  if (bp.launching) return;
  const card = $('#bpRow').querySelector('.bp-card.on');
  const from = card && card.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'bp-launch';
  layer.innerHTML = `
    <div class="bp-launch-bg" style="${g.hero ? `background-image:url('${media(g.hero)}')` : ''}"></div>
    <div class="bp-launch-cover">${bpCardArt(g)}</div>
    <div class="bp-launch-text"><small>Lancement</small><b>${esc(title(g))}</b><div class="bp-launch-bar"><i></i></div></div>`;
  $('#bp').appendChild(layer);
  bp.launching = layer;
  const cover = layer.querySelector('.bp-launch-cover');
  if (from) {
    const to = cover.getBoundingClientRect();
    cover.animate(
      [
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})`, offset: 0 },
        { transform: 'none' },
      ],
      { duration: 650, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
  }
  requestAnimationFrame(() => layer.classList.add('in'));

  const res = await api.launch(g.id, { keepWindow: true });
  if (!res.ok) {
    bpEndLaunch();
    return toast({ type: 'error', title: 'Lancement impossible', text: res.error });
  }
  // The game window takes over; the layer fades out behind it.
  setTimeout(bpEndLaunch, 3800);
}

function bpEndLaunch() {
  const layer = bp.launching;
  if (!layer) return;
  bp.launching = null;
  layer.classList.add('out');
  setTimeout(() => layer.remove(), 450);
}

async function bpAction(name) {
  if (bp.launching) return;
  const g = bpGame();
  if (name === 'back') return closeBigPicture();
  if (!g) return;
  if (name === 'play') {
    if (g.running) return toast({ text: `${title(g)} est déjà lancé`, game: g });
    bpLaunch(g);
  }
  if (name === 'fav') {
    await toggleFav(g.id);
    bpFocus();
  }
}

function openBigPicture() {
  if (bp.open) return;
  closeMenu();
  closeModal();
  closePalette();
  bp.open = true;
  bp.shelf = 0;
  bp.index = 0;
  $('#bp').hidden = false;
  bp.ignoreMouseUntil = performance.now() + 1200;
  bpHideCursor();
  renderBP();
  api.win.fullscreen(true);
  bp.clock = setInterval(bpClock, 15000);
}

function closeBigPicture() {
  if (!bp.open) return;
  bp.open = false;
  bp.launching = null;
  clearTimeout(bp.cursorTimer);
  $('#bp').classList.remove('no-cursor');
  $('#bp').hidden = true;
  $('#bp').innerHTML = '';
  clearInterval(bp.clock);
  api.win.fullscreen(false);
}

// Polls every connected pad: Start/Guide opens the mode, then it drives navigation.
function pollPads() {
  const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
  const now = performance.now();
  for (const pad of pads) {
    const prev = bp.prevButtons[pad.index] || [];
    const pressed = (b) => pad.buttons[b] && pad.buttons[b].pressed;
    const down = (b) => pressed(b) && !prev[b];
    bp.prevButtons[pad.index] = pad.buttons.map((b) => b.pressed);
    if (pad.buttons.some((b, i) => b.pressed && !prev[i]) || Math.abs(pad.axes[0]) > 0.5) {
      setPadKind(padKind(pad));
      if (bp.open) bpHideCursor();
    }

    if (!bp.open) {
      if (down(PAD.START) || down(PAD.HOME)) openBigPicture();
      continue;
    }
    if (!$('#modal').hidden || !$('#palette').hidden) continue;
    if (down(PAD.A)) bpAction('play');
    if (down(PAD.B)) bpAction('back');
    if (down(PAD.Y)) bpAction('fav');
    if (down(PAD.LB)) bpShelf(-1);
    if (down(PAD.RB)) bpShelf(1);

    // Horizontal move with key-repeat: d-pad or left stick.
    const x = pressed(PAD.LEFT) ? -1 : pressed(PAD.RIGHT) ? 1 : Math.abs(pad.axes[0]) > 0.5 ? Math.sign(pad.axes[0]) : 0;
    const y = pressed(PAD.UP) ? -1 : pressed(PAD.DOWN) ? 1 : Math.abs(pad.axes[1]) > 0.6 ? Math.sign(pad.axes[1]) : 0;
    const key = `${pad.index}`;
    const h = bp.held[key] || (bp.held[key] = { x: 0, y: 0, next: 0 });
    if (x !== h.x || y !== h.y) {
      h.x = x; h.y = y;
      if (bp.launching) continue;
      if (x) bpMove(x);
      if (y) bpShelf(y);
      h.next = now + 380;
    } else if (x && now >= h.next && !bp.launching) {
      bpMove(x);
      h.next = now + 110;
    }
  }
  bp.raf = requestAnimationFrame(pollPads);
}

function bindBigPicture() {
  $('#btnBigPicture').onclick = openBigPicture;
  $('#bp').addEventListener('mousemove', bpShowCursor);
  $('#bp').onclick = (e) => {
    if (bp.launching) return;
    const tab = e.target.closest('[data-shelf]');
    if (tab) { bp.shelf = Number(tab.dataset.shelf); bp.index = 0; return renderBP(); }
    const card = e.target.closest('[data-i]');
    if (!card) return;
    const i = Number(card.dataset.i);
    if (i === bp.index) bpAction('play');
    else { bp.index = i; bpFocus(); }
  };
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        return bp.open ? closeBigPicture() : openBigPicture();
      }
      if (!bp.open || !$('#modal').hidden || !$('#palette').hidden) return;
      const map = { ArrowLeft: () => bpMove(-1), ArrowRight: () => bpMove(1), ArrowUp: () => bpShelf(-1), ArrowDown: () => bpShelf(1), Enter: () => bpAction('play'), Escape: () => bpAction('back'), Backspace: () => bpAction('back'), f: () => bpAction('fav') };
      const fn = map[e.key];
      if (!fn) return;
      e.preventDefault();
      e.stopPropagation();
      if (!bp.pad) setPadKind('keyboard');
      bpHideCursor();
      if (!bp.launching) fn();
    },
    true
  );
  // Keep the view in sync when a game starts/stops or gets new art while the mode is open.
  api.onGameUpdated((g) => g && bp.open && setTimeout(() => bpRefreshCard(g.id), 0));
  addEventListener('gamepadconnected', (e) => {
    setPadKind(padKind(e.gamepad));
    toast({ text: `Manette ${bp.pad === 'ps' ? 'PlayStation' : 'Xbox'} détectée · ${bp.pad === 'ps' ? 'Options' : 'Start'} pour le mode manette` });
  });
  bp.raf = requestAnimationFrame(pollPads);
}
