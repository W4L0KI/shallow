// Renders the brand mark to assets/icon.png + assets/icon.ico (run with: npx electron scripts/make-icon.js)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b7bff"/><stop offset="1" stop-color="#d36bff"/></linearGradient>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1830"/><stop offset="1" stop-color="#0b0b14"/></linearGradient></defs>
<rect x="8" y="8" width="240" height="240" rx="58" fill="url(#bg)" stroke="#8b7bff" stroke-opacity=".45" stroke-width="4"/>
<g transform="translate(32 32) scale(6)"><path d="M4 20c4-1.5 7.5-1.5 12 0s8 1.5 12 0v4c-4 1.5-7.5 1.5-12 0s-8-1.5-12 0z" fill="url(#g)" opacity=".55"/>
<path d="M4 12c4-1.5 7.5-1.5 12 0s8 1.5 12 0v4c-4 1.5-7.5 1.5-12 0s-8-1.5-12 0z" fill="url(#g)"/></g></svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="256" height="256" ')}</body>`));
  await new Promise((r) => setTimeout(r, 500));
  const png = (await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 })).resize({ width: 256, height: 256 }).toPNG();
  const out = path.join(__dirname, '..', 'assets');
  fs.writeFileSync(path.join(out, 'icon.png'), png);
  // ICO container holding a single 256px PNG.
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6); header.writeUInt8(0, 7); header.writeUInt8(0, 8); header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, png]));
  app.quit();
});
