// Full-page views (Historique, …) shown in place of the hero + library grid.

const DAY = 86400000;
const dayStart = (ts) => new Date(new Date(ts).toDateString()).getTime();
const fmtDur = (sec) => fmtPlaytime(sec) || '0 min';

function fmtHours(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

function sessionsBetween(from, to) {
  return state.sessions.filter((s) => s.start >= from && s.start < to);
}

const sumSeconds = (list) => list.reduce((t, s) => t + s.seconds, 0);

// Seconds per game, biggest first.
function perGame(list) {
  const map = new Map();
  for (const s of list) map.set(s.game, (map.get(s.game) || 0) + s.seconds);
  return [...map.entries()].filter(([id]) => state.games.has(id)).sort((a, b) => b[1] - a[1]);
}

// Consecutive days with at least one session. The current streak still counts if today is empty.
function streaks() {
  const days = new Set(state.sessions.map((s) => dayStart(s.start)));
  const today = dayStart(Date.now());
  let current = 0;
  let d = days.has(today) ? today : today - DAY;
  while (days.has(d)) { current++; d = dayStart(d - DAY / 2); }
  let best = 0, run = 0, prev = null;
  for (const day of [...days].sort((a, b) => a - b)) {
    run = prev !== null && day - prev < DAY * 1.5 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return { current, best };
}

function fmtSessionDate(ts) {
  const d = new Date(ts);
  const day = fmtLastPlayed(ts);
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

function gameThumb(g) {
  return g && g.cover ? `<img src="${media(g.cover)}" alt="" loading="lazy">` : `<div class="thumb-ph" style="--h:${hue(g ? title(g) : '')}"></div>`;
}

// ---------- Historique ----------

function historyHtml() {
  const now = Date.now();
  const today = dayStart(now);
  const week = sessionsBetween(today - 6 * DAY, now + 1);
  const prevWeek = sessionsBetween(today - 13 * DAY, today - 6 * DAY);
  const month30 = sessionsBetween(today - 29 * DAY, now + 1);
  const { current, best } = streaks();
  const weekSec = sumSeconds(week);
  const diff = weekSec - sumSeconds(prevWeek);

  const tiles = `
    <div class="tiles">
      <div class="tile"><small>7 derniers jours</small><b>${fmtHours(weekSec)}</b>
        <span>${prevWeek.length ? `${diff >= 0 ? '+' : '−'}${fmtHours(Math.abs(diff))} vs la semaine d’avant` : `${week.length} session${week.length > 1 ? 's' : ''}`}</span></div>
      <div class="tile"><small>Série en cours</small><b>${current} jour${current > 1 ? 's' : ''}</b>
        <span>${best > current ? `Record : ${best} jours` : 'Jours d’affilée avec au moins une session'}</span></div>
      <div class="tile"><small>Sessions sur 30 jours</small><b>${month30.length}</b>
        <span>${month30.length ? `${fmtDur(Math.round(sumSeconds(month30) / month30.length))} en moyenne` : 'Aucune pour l’instant'}</span></div>
    </div>`;

  // Bar chart, one bar per day over the last 30 days.
  const days = Array.from({ length: 30 }, (_, i) => today - (29 - i) * DAY);
  const perDay = days.map((d) => sumSeconds(sessionsBetween(d, d + DAY)));
  const max = Math.max(...perDay, 1);
  const bars = days
    .map((d, i) => {
      const label = new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      const h = perDay[i] ? Math.max(4, (perDay[i] / max) * 100) : 0;
      return `<div class="bar ${d === today ? 'today' : ''}" title="${label} · ${fmtDur(perDay[i])}"><i style="height:${h}%"></i></div>`;
    })
    .join('');
  const axisLabel = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const top = perGame(sessionsBetween(monthStart, now + 1)).slice(0, 6);
  const topMax = top.length ? top[0][1] : 1;
  const topHtml = top.length
    ? top
        .map(([id, sec]) => {
          const g = state.games.get(id);
          return `<button class="top-row" data-id="${id}">${gameThumb(g)}<div><div class="top-line"><b>${esc(title(g))}</b><span>${fmtHours(sec)}</span></div>
            <div class="meter"><i style="width:${(sec / topMax) * 100}%"></i></div></div></button>`;
        })
        .join('')
    : '<div class="panel-empty">Rien joué ce mois-ci.</div>';

  const recent = [...state.sessions].reverse().filter((s) => state.games.has(s.game)).slice(0, 12);
  const recentHtml = recent.length
    ? recent
        .map((s) => {
          const g = state.games.get(s.game);
          return `<button class="session-row" data-id="${s.game}">${gameThumb(g)}
            <div class="session-main"><b>${esc(title(g))}</b><small>${fmtSessionDate(s.start)}</small>${s.note ? `<p>${esc(s.note)}</p>` : ''}</div>
            <span class="session-dur">${fmtDur(s.seconds)}</span></button>`;
        })
        .join('')
    : `<div class="panel-empty">${icon('clock')}<div>Lance un jeu depuis Shallow : chaque session apparaîtra ici.</div></div>`;

  return `
    <div class="page-head"><h1>Historique</h1><span class="lib-count">${state.sessions.length} session${state.sessions.length > 1 ? 's' : ''}</span></div>
    ${tiles}
    <div class="hist-row">
      <div class="panel chart-panel">
        <div class="panel-head"><h3>30 derniers jours</h3><span>${fmtHours(sumSeconds(month30))}</span></div>
        <div class="chart">${bars}</div>
        <div class="chart-axis"><span>${axisLabel(days[0])}</span><span>${axisLabel(days[15])}</span><span>Aujourd’hui</span></div>
      </div>
      <div class="panel top-panel">
        <div class="panel-head"><h3>Ce mois-ci</h3></div>
        ${topHtml}
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Sessions récentes</h3></div>
      <div class="session-list">${recentHtml}</div>
    </div>`;
}

// ---------- Récap ----------

const recap = { mode: 'month', offset: 0 };

function recapRange() {
  const now = new Date();
  if (recap.mode === 'year') {
    const y = now.getFullYear() + recap.offset;
    return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime(), label: String(y) };
  }
  const d = new Date(now.getFullYear(), now.getMonth() + recap.offset, 1);
  const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return { from: d.getTime(), to: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(), label: label[0].toUpperCase() + label.slice(1) };
}

function recapHtml() {
  const { from, to, label } = recapRange();
  const list = sessionsBetween(from, to).filter((s) => state.games.has(s.game));
  const unit = recap.mode === 'year' ? 'de l’année' : 'du mois';
  const head = `
    <div class="page-head"><h1>Récap</h1>
      <div class="page-tools">
        <div class="segmented">${[['month', 'Mois'], ['year', 'Année']].map(([m, l]) => `<button data-recap-mode="${m}" class="${recap.mode === m ? 'active' : ''}">${l}</button>`).join('')}</div>
        <div class="period"><button data-recap-step="-1" title="Précédent">${icon('chevronLeft')}</button><b>${label}</b>
          <button data-recap-step="1" title="Suivant" ${recap.offset >= 0 ? 'disabled' : ''}>${icon('chevronRight')}</button></div>
      </div>
    </div>`;
  if (!list.length) {
    return `${head}<div class="panel"><div class="panel-empty">${icon('sparkle')}<div>Aucune session sur cette période. Joue un peu, ton récap se remplira tout seul.</div></div></div>`;
  }

  const total = sumSeconds(list);
  const games = perGame(list);
  const [topId, topSec] = games[0];
  const topGame = state.games.get(topId);
  const longest = list.reduce((a, b) => (b.seconds > a.seconds ? b : a));
  const activeDays = new Set(list.map((s) => dayStart(s.start))).size;

  const firstSeen = new Map();
  for (const s of state.sessions) if (!firstSeen.has(s.game)) firstSeen.set(s.game, s.start);
  const discovered = games.filter(([id]) => firstSeen.get(id) >= from && firstSeen.get(id) < to);

  const hero = `
    <div class="recap-hero">
      <div class="recap-art" style="background-image:url('${media(topGame.hero || topGame.cover)}')"></div>
      ${topGame.cover ? `<img class="recap-cover" src="${media(topGame.cover)}" alt="">` : ''}
      <div class="recap-text">
        <small>Ton jeu ${unit}</small>
        <h2>${esc(title(topGame))}</h2>
        <p>${fmtDur(topSec)} · ${Math.round((topSec / total) * 100)} % de ton temps de jeu</p>
      </div>
    </div>`;

  const tiles = `
    <div class="tiles four">
      <div class="tile"><small>Temps de jeu</small><b>${fmtHours(total)}</b><span>${activeDays} jour${activeDays > 1 ? 's' : ''} de jeu</span></div>
      <div class="tile"><small>Sessions</small><b>${list.length}</b><span>${fmtDur(Math.round(total / list.length))} en moyenne</span></div>
      <div class="tile"><small>Jeux lancés</small><b>${games.length}</b><span>${discovered.length ? `dont ${discovered.length} découverte${discovered.length > 1 ? 's' : ''}` : 'Que des habitués'}</span></div>
      <div class="tile"><small>Plus longue session</small><b>${fmtHours(longest.seconds)}</b><span>${esc(title(state.games.get(longest.game)))}</span></div>
    </div>`;

  // When you play: time of day + weekday.
  const slots = [['Nuit', 0, 6], ['Matin', 6, 12], ['Après-midi', 12, 18], ['Soirée', 18, 24]].map(([name, a, b]) => [
    name,
    sumSeconds(list.filter((s) => { const h = new Date(s.start).getHours(); return h >= a && h < b; })),
  ]);
  const slotMax = Math.max(...slots.map((s) => s[1]), 1);
  const favSlot = slots.reduce((a, b) => (b[1] > a[1] ? b : a));
  const weekdays = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((name, i) => [
    name,
    sumSeconds(list.filter((s) => (new Date(s.start).getDay() + 6) % 7 === i)),
  ]);
  const wdMax = Math.max(...weekdays.map((w) => w[1]), 1);
  const favDay = weekdays.reduce((a, b) => (b[1] > a[1] ? b : a));
  const slotNames = { Nuit: 'la nuit', Matin: 'le matin', 'Après-midi': 'l’après-midi', Soirée: 'en soirée' };
  const dayNames = { Lun: 'le lundi', Mar: 'le mardi', Mer: 'le mercredi', Jeu: 'le jeudi', Ven: 'le vendredi', Sam: 'le samedi', Dim: 'le dimanche' };

  const habits = `
    <div class="panel">
      <div class="panel-head"><h3>Tes habitudes</h3><span>Surtout ${slotNames[favSlot[0]]}, ${dayNames[favDay[0]]}</span></div>
      <div class="habits">
        <div>${slots.map(([n, sec]) => `<div class="habit-row"><span>${n}</span><div class="meter"><i style="width:${(sec / slotMax) * 100}%"></i></div><small>${fmtHours(sec)}</small></div>`).join('')}</div>
        <div class="week-bars">${weekdays.map(([n, sec]) => `<div class="bar" title="${n} · ${fmtDur(sec)}"><i style="height:${sec ? Math.max(4, (sec / wdMax) * 100) : 0}%"></i><small>${n}</small></div>`).join('')}</div>
      </div>
    </div>`;

  const topMax = games[0][1];
  const top = `
    <div class="panel">
      <div class="panel-head"><h3>Classement</h3><span>${games.length} jeu${games.length > 1 ? 'x' : ''}</span></div>
      ${games.slice(0, 8).map(([id, sec], i) => {
        const g = state.games.get(id);
        return `<button class="top-row" data-id="${id}"><span class="rank">${i + 1}</span>${gameThumb(g)}<div><div class="top-line"><b>${esc(title(g))}</b>
          ${discovered.some(([d]) => d === id) ? '<em class="new-tag">Nouveau</em>' : ''}<span>${fmtHours(sec)}</span></div>
          <div class="meter"><i style="width:${(sec / topMax) * 100}%"></i></div></div></button>`;
      }).join('')}
    </div>`;

  return `${head}${hero}${tiles}<div class="hist-row recap-row">${top}${habits}</div>`;
}

// ---------- Journal ----------

const journal = { onlyNotes: false, focus: null };

function journalHtml() {
  const list = [...state.sessions]
    .reverse()
    .filter((s) => state.games.has(s.game) && (!journal.onlyNotes || s.note))
    .slice(0, 300);
  const withNotes = state.sessions.filter((s) => s.note).length;
  const head = `
    <div class="page-head"><h1>Journal</h1><span class="lib-count">${withNotes} note${withNotes > 1 ? 's' : ''}</span>
      <div class="page-tools"><div class="segmented">
        <button data-journal="all" class="${journal.onlyNotes ? '' : 'active'}">Toutes les sessions</button>
        <button data-journal="notes" class="${journal.onlyNotes ? 'active' : ''}">Avec une note</button>
      </div></div>
    </div>`;
  if (!list.length) {
    return `${head}<div class="panel"><div class="panel-empty">${icon('note')}<div>${
      journal.onlyNotes ? 'Aucune note pour l’instant. Ajoute-en une sous n’importe quelle session.' : 'Ton journal se remplit à chaque session lancée depuis Shallow.'
    }</div></div></div>`;
  }

  const days = new Map();
  for (const s of list) {
    const d = dayStart(s.start);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(s);
  }
  const time = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const body = [...days.entries()]
    .map(([d, items]) => {
      const label = new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: new Date(d).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
      const rows = items
        .map((s) => {
          const g = state.games.get(s.game);
          return `<div class="journal-entry">
            <button class="journal-thumb" data-id="${s.game}" title="Afficher le jeu">${gameThumb(g)}</button>
            <div class="journal-main">
              <div class="journal-line"><button class="journal-game" data-id="${s.game}">${esc(title(g))}</button>
                <small>${time(s.start)} → ${time(s.start + s.seconds * 1000)}</small><span class="session-dur">${fmtDur(s.seconds)}</span></div>
              <textarea class="journal-note" data-session="${s.id}" rows="1" placeholder="Ajouter une note sur cette session…" maxlength="1000">${esc(s.note || '')}</textarea>
            </div>
          </div>`;
        })
        .join('');
      return `<div class="journal-day"><div class="journal-date"><b>${label[0].toUpperCase() + label.slice(1)}</b><span>${fmtDur(sumSeconds(items))}</span></div>${rows}</div>`;
    })
    .join('');
  return `${head}<div class="panel journal">${body}</div>`;
}

function autosize(t) {
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 'px';
}

// Called after the journal is rendered: notes save themselves when you leave the field.
function mountJournal(page) {
  page.querySelectorAll('.journal-note').forEach((t) => {
    autosize(t);
    t.oninput = () => autosize(t);
    t.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); t.blur(); }
      if (e.key === 'Escape') { e.stopPropagation(); t.blur(); }
    };
    t.onchange = async () => {
      const note = t.value.trim() || null;
      const s = await api.updateSession(t.dataset.session, { note });
      if (!s) return;
      Object.assign(state.sessions.find((x) => x.id === s.id), s);
      t.classList.add('saved');
      setTimeout(() => t.classList.remove('saved'), 900);
      const count = page.querySelector('.page-head .lib-count');
      const n = state.sessions.filter((x) => x.note).length;
      if (count) count.textContent = `${n} note${n > 1 ? 's' : ''}`;
    };
  });
  if (journal.focus) {
    const t = page.querySelector(`.journal-note[data-session="${CSS.escape(journal.focus)}"]`);
    journal.focus = null;
    if (t) { t.scrollIntoView({ block: 'center' }); t.focus(); }
  }
}

function journalClick(e) {
  const b = e.target.closest('[data-journal]');
  if (!b) return false;
  journal.onlyNotes = b.dataset.journal === 'notes';
  renderPage();
  return true;
}

function noteSession(sessionId) {
  journal.focus = sessionId;
  journal.onlyNotes = false;
  openPage('journal');
}

const PAGES = {
  history: { label: 'Historique', icon: 'chart', html: historyHtml },
  journal: { label: 'Journal', icon: 'note', html: journalHtml, mount: mountJournal },
  recap: { label: 'Récap', icon: 'sparkle', html: recapHtml },
};

function recapClick(e) {
  const mode = e.target.closest('[data-recap-mode]');
  const step = e.target.closest('[data-recap-step]');
  if (!mode && !step) return false;
  if (mode) { recap.mode = mode.dataset.recapMode; recap.offset = 0; }
  if (step) recap.offset = Math.min(0, recap.offset + Number(step.dataset.recapStep));
  renderPage();
  return true;
}

function renderPage() {
  const page = $('#page');
  const on = !!state.page;
  $('#hero').hidden = on;
  $('.library').hidden = on;
  page.hidden = !on;
  if (!on) return;
  page.innerHTML = PAGES[state.page].html();
  page.classList.remove('in');
  void page.offsetWidth;
  page.classList.add('in');
  if (PAGES[state.page].mount) PAGES[state.page].mount(page);
  // Ambient glow follows the most played game of the month.
  const top = perGame(sessionsBetween(Date.now() - 30 * DAY, Date.now() + 1))[0];
  const g = top && state.games.get(top[0]);
  setAmbient(g ? media(g.cover || g.hero) : null);
}
