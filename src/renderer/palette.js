// Ctrl+K quick launcher: find a game (or an action) and run it from the keyboard.

const palette = { items: [], index: 0 };

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function fuzzyScore(text, q) {
  const t = norm(text);
  if (t.startsWith(q)) return 4;
  if (t.split(/[\s:\-–]+/).some((w) => w.startsWith(q))) return 3;
  if (t.includes(q)) return 2;
  let i = 0;
  for (const c of t) if (c === q[i]) i++;
  return i === q.length ? 1 : 0;
}

const COMMANDS = [
  { label: 'Bibliothèque', icon: 'library', run: () => setView('all') },
  { label: 'Favoris', icon: 'heart', run: () => setView('favorites') },
  { label: 'Historique', icon: 'chart', run: () => openPage('history') },
  { label: 'Journal', icon: 'note', run: () => openPage('journal') },
  { label: 'Récap', icon: 'sparkle', run: () => openPage('recap') },
  { label: 'Mode manette', icon: 'gamepad', run: () => openBigPicture() },
  { label: 'Ajouter un jeu', icon: 'plus', run: () => $('#btnAdd').click() },
  { label: 'Paramètres', icon: 'settings', run: () => openSettings() },
];

function paletteResults(query) {
  const q = norm(query.trim());
  const games = [...state.games.values()].filter((g) => !g.hidden);
  if (!q) {
    const recent = games.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 5);
    const favs = games.filter((g) => g.favorite && !recent.includes(g)).slice(0, Math.max(2, 6 - recent.length));
    return [
      ...[...recent, ...favs].map((g) => ({ game: g, group: recent.includes(g) ? 'Récemment joués' : 'Favoris' })),
      ...COMMANDS.map((c) => ({ cmd: c, group: 'Aller à' })),
    ];
  }
  const found = games
    .map((g) => ({ g, s: Math.max(fuzzyScore(title(g), q), fuzzyScore(g.name, q)) }))
    .filter((x) => x.s)
    .sort((a, b) => b.s - a.s || (b.g.lastPlayed || 0) - (a.g.lastPlayed || 0) || title(a.g).localeCompare(title(b.g), 'fr'))
    .slice(0, 8)
    .map(({ g }) => ({ game: g, group: 'Jeux' }));
  const cmds = COMMANDS.filter((c) => fuzzyScore(c.label, q)).map((c) => ({ cmd: c, group: 'Aller à' }));
  return [...found, ...cmds];
}

function renderPalette() {
  const list = $('#paletteList');
  let group = null;
  list.innerHTML = palette.items.length
    ? palette.items
        .map((it, i) => {
          const head = it.group !== group ? `<div class="palette-group">${(group = it.group)}</div>` : '';
          if (it.cmd) return `${head}<button class="palette-item ${i === palette.index ? 'on' : ''}" data-i="${i}"><span class="palette-ic">${icon(it.cmd.icon)}</span><b>${it.cmd.label}</b></button>`;
          const g = it.game;
          const sub = g.running ? 'En cours' : fmtPlaytime(g.playtime) ? `${fmtPlaytime(g.playtime)} · ${fmtLastPlayed(g.lastPlayed)}` : 'Jamais joué';
          return `${head}<button class="palette-item ${i === palette.index ? 'on' : ''}" data-i="${i}">${gameThumb(g)}
            <span class="palette-text"><b>${esc(title(g))}</b><small>${sub}</small></span>
            <span class="palette-play" data-play="${i}" title="Jouer">${icon('play')}</span></button>`;
        })
        .join('')
    : `<div class="palette-empty">Aucun résultat pour « ${esc($('#paletteInput').value)} »</div>`;
  list.querySelector('.palette-item.on')?.scrollIntoView({ block: 'nearest' });
}

function openPalette() {
  closeMenu();
  $('#palette').hidden = false;
  const input = $('#paletteInput');
  input.value = '';
  palette.items = paletteResults('');
  palette.index = 0;
  renderPalette();
  input.focus();
}

function closePalette() {
  $('#palette').hidden = true;
}

function runPaletteItem(i, { show = false } = {}) {
  const it = palette.items[i];
  if (!it) return;
  closePalette();
  if (it.cmd) return it.cmd.run();
  if (show) return showGame(it.game.id);
  launch(it.game.id);
}

function bindPalette() {
  const input = $('#paletteInput');
  input.oninput = () => {
    palette.items = paletteResults(input.value);
    palette.index = 0;
    renderPalette();
  };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = palette.items.length;
      if (n) palette.index = (palette.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      renderPalette();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runPaletteItem(palette.index, { show: e.shiftKey });
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      closePalette();
    }
  };
  $('#paletteList').onmousemove = (e) => {
    const b = e.target.closest('[data-i]');
    if (b && Number(b.dataset.i) !== palette.index) {
      palette.index = Number(b.dataset.i);
      $('#paletteList').querySelectorAll('.palette-item').forEach((x) => x.classList.toggle('on', x === b));
    }
  };
  $('#paletteList').onclick = (e) => {
    const play = e.target.closest('[data-play]');
    if (play) return runPaletteItem(Number(play.dataset.play));
    const b = e.target.closest('[data-i]');
    if (b) runPaletteItem(Number(b.dataset.i), { show: !!palette.items[b.dataset.i].game });
  };
  $('#palette').onclick = (e) => e.target === $('#palette') && closePalette();
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        $('#palette').hidden ? openPalette() : closePalette();
      }
    },
    true
  );
}
