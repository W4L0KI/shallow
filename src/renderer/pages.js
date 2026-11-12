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

const PAGES = {
  history: { label: 'Historique', icon: 'chart', html: historyHtml },
};

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
  // Ambient glow follows the most played game of the month.
  const top = perGame(sessionsBetween(Date.now() - 30 * DAY, Date.now() + 1))[0];
  const g = top && state.games.get(top[0]);
  setAmbient(g ? media(g.cover || g.hero) : null);
}
