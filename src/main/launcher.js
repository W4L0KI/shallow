// Starts games and tracks play sessions by watching the process list.
const { spawn, execFile } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');
const { listExes } = require('./scanner');

const POLL_MS = 15000;
const GRACE_MS = 60000; // launchers/UAC prompts can take a while before the game shows up
const GENERIC = /^(launcher|unins\d*|unitycrashhandler(32|64)?|crashhandler|crs-.*|qtwebengineprocess|steam|cefprocess|.*setup|.*redist.*)\.exe$/i;

function parseArgs(str) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(str || ''))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

function runningImages() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      const set = new Set();
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^"([^"]+)"/);
        if (m) set.add(m[1].toLowerCase());
      }
      resolve(set);
    });
  });
}

class Launcher extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map(); // id -> { start, lastSeen, images }
    this.timer = null;
  }

  isRunning(id) {
    return this.sessions.has(id);
  }

  runningIds() {
    return [...this.sessions.keys()];
  }

  launch(game) {
    if (this.sessions.has(game.id)) return { ok: true, already: true };
    const cwd = path.dirname(game.exe);
    const args = parseArgs(game.args);
    try {
      const child = spawn(game.exe, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', (err) => {
        // Elevation required (or similar): let the shell handle it, which shows the UAC prompt.
        if (err.code === 'EACCES' || err.errno === -4048 || /740/.test(String(err.message))) this._shellStart(game.exe, args, cwd);
        else this.emit('error', game.id, err.message);
      });
      child.unref();
    } catch (err) {
      this._shellStart(game.exe, args, cwd);
    }

    const images = new Set([path.basename(game.exe).toLowerCase()]);
    for (const e of listExes(game.folder)) if (!GENERIC.test(e.name)) images.add(e.name.toLowerCase());
    const now = Date.now();
    this.sessions.set(game.id, { start: now, lastSeen: now, images });
    this.emit('started', game.id);
    if (!this.timer) this.timer = setInterval(() => this._poll(), POLL_MS);
    return { ok: true };
  }

  _shellStart(exe, args, cwd) {
    const quoted = args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
    spawn('cmd.exe', ['/d', '/c', `start "" /D "${cwd}" "${exe}" ${quoted}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true,
    }).unref();
  }

  async _poll() {
    const images = await runningImages();
    if (!images) return;
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      const alive = [...s.images].some((img) => images.has(img));
      if (alive) s.lastSeen = now;
      else if (now - s.start > GRACE_MS) {
        this.sessions.delete(id);
        const seconds = Math.max(0, Math.round((s.lastSeen - s.start) / 1000));
        this.emit('stopped', id, seconds);
      }
    }
    if (!this.sessions.size) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  stop(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    for (const img of s.images) execFile('taskkill', ['/IM', img, '/T', '/F'], { windowsHide: true }, () => {});
  }
}

module.exports = { Launcher, parseArgs };
