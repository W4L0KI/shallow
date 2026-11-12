// Mode manette: a full-screen, couch-friendly view driven by a gamepad (or the keyboard).

const bp = { open: false, shelf: 0, index: 0, shelves: [], raf: 0, held: {}, prevButtons: [] };

// Standard gamepad mapping (Xbox layout).
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16 };

function bpShelves() {
  const games = [...state.games.values()].filter((g) => !g.hidden);
  const byName = (a, b) => title(a).localeCompare(title(b), 'fr', { sensitivity: 'base' });
  const shelves = [
    { label: 'Récents', games: games.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed) },
    { label: 'Favoris', games: games.filter((g) => g.favorite).sort(byName) },
    { label: 'Tous les jeux', games: [...games].sort(byName) },
    ...allCollections().map((c) => ({ label: c, games: games.filter((g) => (g.collections || []).includes(c)).sort(byName) })),
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

function renderBP() {
  bp.shelves = bpShelves();
  bp.shelf = Math.min(bp.shelf, Math.max(0, bp.shelves.length - 1));
  const shelf = bp.shelves[bp.shelf];
  bp.index = shelf ? Math.min(bp.index, shelf.games.length - 1) : 0;
  $('#bp').innerHTML = `
    <div class="bp-art" id="bpArt"></div>
    <header class="bp-top">
      <div class="bp-brand">${$('.brand-mark').outerHTML}<span>Shallow</span></div>
      <nav class="bp-tabs"><span class="bp-key">LB</span>${bp.shelves.map((s, i) => `<button class="${i === bp.shelf ? 'on' : ''}" data-shelf="${i}">${esc(s.label)}</button>`).join('')}<span class="bp-key">RB</span></nav>
      <div class="bp-clock" id="bpClock"></div>
    </header>
    <section class="bp-info" id="bpInfo"></section>
    <div class="bp-row" id="bpRow">${
      shelf
        ? shelf.games
            .map(
              (g, i) => `<button class="bp-card ${i === bp.index ? 'on' : ''}" data-i="${i}">
                ${g.cover ? `<img src="${media(g.cover)}" alt="" loading="lazy">` : `<div class="placeholder" style="--h:${hue(title(g))}">${esc(title(g))}</div>`}
                ${g.running ? '<span class="card-badge">En cours</span>' : ''}</button>`
            )
            .join('')
        : '<div class="bp-empty">Aucun jeu à afficher.</div>'
    }</div>
    <footer class="bp-legend">
      <span><i class="bp-btn a">A</i>Jouer</span><span><i class="bp-btn y">Y</i>Favori</span><span><i class="bp-btn b">B</i>Quitter</span>
    </footer>`;
  bpClock();
  bpFocus(false);
}

// Update the focused card and the info panel without rebuilding the row.
function bpFocus(smooth = true) {
  const g = bpGame();
  $('#bpRow').querySelectorAll('.bp-card').forEach((c, i) => c.classList.toggle('on', i === bp.index));
  const card = $('#bpRow').querySelector('.bp-card.on');
  if (card) card.scrollIntoView({ inline: 'center', block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  if (!g) return;
  const art = $('#bpArt');
  const src = media(g.hero || g.cover);
  if (art.dataset.src !== src) {
    art.dataset.src = src;
    art.style.backgroundImage = `url("${src}")`;
    art.classList.toggle('blurred', !g.hero);
    art.classList.remove('on');
    void art.offsetWidth;
    art.classList.add('on');
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

async function bpAction(name) {
  const g = bpGame();
  if (name === 'back') return closeBigPicture();
  if (!g) return;
  if (name === 'play') launch(g.id);
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
  renderBP();
  api.win.fullscreen(true);
  bp.clock = setInterval(bpClock, 15000);
}

function closeBigPicture() {
  if (!bp.open) return;
  bp.open = false;
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
      if (x) bpMove(x);
      if (y) bpShelf(y);
      h.next = now + 380;
    } else if (x && now >= h.next) {
      bpMove(x);
      h.next = now + 110;
    }
  }
  bp.raf = requestAnimationFrame(pollPads);
}

function bindBigPicture() {
  $('#btnBigPicture').onclick = openBigPicture;
  $('#bp').onclick = (e) => {
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
      fn();
    },
    true
  );
  // Keep the grid view in sync when a game starts/stops while the mode is open.
  api.onGameUpdated(() => bp.open && setTimeout(() => bp.open && bpFocus(false), 0));
  addEventListener('gamepadconnected', () => toast({ text: 'Manette détectée · Start pour le mode manette' }));
  bp.raf = requestAnimationFrame(pollPads);
}
