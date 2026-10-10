// Renders assets/icon.svg into menubar/AppIcon.icns (all macOS sizes) and docs/images/icon.png,
// using headless Chrome for rasterizing and macOS `iconutil` for packaging. Usage: npm run build:icon
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../server/src/config.js';
import { launchChrome, openPage } from '../server/src/headless/chrome.js';

const svg = readFileSync('assets/icon.svg', 'utf8');
const work = mkdtempSync(join(tmpdir(), 'tt-icon-'));
const iconset = join(work, 'AppIcon.iconset');
mkdirSync(iconset);

const { headless } = loadConfig({ TOKENTRACKING_HOME: work });
const conn = await launchChrome({ chromePath: headless.chromePath, profileDir: join(work, 'profile') });
const page = await openPage(conn);
await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }); // transparent corners

async function render(px) {
  await page.send('Emulation.setDeviceMetricsOverride', { width: px, height: px, deviceScaleFactor: 1, mobile: false });
  const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg style="display:block;width:${px}px;height:${px}px" `)}</body></html>`;
  await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return page.screenshot();
}

// Apple's iconset naming: icon_<pt>x<pt>[@2x].png
for (const pt of [16, 32, 128, 256, 512]) {
  writeFileSync(join(iconset, `icon_${pt}x${pt}.png`), await render(pt));
  writeFileSync(join(iconset, `icon_${pt}x${pt}@2x.png`), await render(pt * 2));
}
mkdirSync('docs/images', { recursive: true });
writeFileSync('docs/images/icon.png', await render(256));
await page.close();
await conn.close();

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', 'menubar/AppIcon.icns']);
rmSync(work, { recursive: true, force: true });
console.log('Wrote menubar/AppIcon.icns and docs/images/icon.png');
