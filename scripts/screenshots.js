// Regenerates the README screenshots in docs/images/ from demo data (never real usage):
// dashboard (light + dark), compact web panel and menu bar glyphs; builds a native demo
// preview for separate panel/Settings capture. Usage: npm run screenshots
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../server/src/config.js';
import { openDb } from '../server/src/db.js';
import { createApp } from '../server/src/server.js';
import { launchChrome, openPage } from '../server/src/headless/chrome.js';

const OUT = 'docs/images';
mkdirSync(OUT, { recursive: true });
const home = mkdtempSync(join(tmpdir(), 'tt-shots-'));

// 1. Demo data in a throwaway home, served by an in-process service on a free port.
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/seed-demo.js'], { env: { ...process.env, TOKENTRACKING_DEMO_HOME: home } });
const config = loadConfig({ TOKENTRACKING_HOME: home, TOKENTRACKING_HEADLESS: '0' });
const db = openDb(config.dbPath);
const probe = createApp({ db, config });
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
config.port = probe.address().port;
await new Promise((r) => probe.close(r));
const server = createApp({ db, config });
await new Promise((r) => server.listen(config.port, '127.0.0.1', r));
const base = `http://127.0.0.1:${config.port}`;

// 2. Screenshots with headless Chrome (throwaway profile), at 2x for crisp images.
const profile = mkdtempSync(join(tmpdir(), 'tt-shots-chrome-'));
const conn = await launchChrome({ chromePath: config.headless.chromePath, profileDir: profile });
async function shot(file, { path, width, height, scheme, fullPage = false }) {
  const page = await openPage(conn);
  const send = (m, p) => page.send(m, p);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  await page.goto(base + path);
  await new Promise((r) => setTimeout(r, 800));
  if (fullPage) {
    const h = await page.evaluate('Math.ceil(document.documentElement.scrollHeight)');
    await send('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 2, mobile: false });
    await new Promise((r) => setTimeout(r, 300));
  }
  writeFileSync(join(OUT, file), await page.screenshot());
  await page.close();
  console.log(`  ${OUT}/${file}`);
}
await shot('dashboard-light.png', { path: '/', width: 1200, height: 900, scheme: 'light', fullPage: true });
await shot('dashboard-dark.png', { path: '/', width: 1200, height: 900, scheme: 'dark', fullPage: true });
await shot('compact-dark.png', { path: '/?compact', width: 400, height: 560, scheme: 'dark' });
const statusPath = join(home, 'demo-status.json');
writeFileSync(statusPath, JSON.stringify(await (await fetch(base + '/api/status')).json()));
await conn.close();
server.close();
db.close();

// 3. Menu bar glyphs: compile the app's own MenuBarGlyphs code into a tiny renderer (needs swift).
try {
  const src = readFileSync('menubar/TokenTrackingMenu.swift', 'utf8');
  const glyphs = src.slice(src.indexOf('/// One service in the menu bar'), src.indexOf('// MARK: - Status polling'));
  const dateParser = src.slice(src.indexOf('func parseDate('), src.indexOf('/// "2d 4h"'));
  const swiftFile = join(home, 'glyphs.swift');
  writeFileSync(swiftFile, `import AppKit
${glyphs}
${dateParser}
let slots = [("claude", 92.0), ("cursor", 72), ("antigravity", 51), ("grok-bot", 18), ("openai", 42), ("muse", 87)]
  .map { MenuSlot(symbol: $0.0, text: MenuBarGlyphs.digits($0.1)) }
let glyph = MenuBarGlyphs.image(for: slots)
let s: CGFloat = 2, pad: CGFloat = 14, band: CGFloat = 26
let out = NSImage(size: NSSize(width: (glyph.size.width + pad * 2) * s, height: band * 2 * s), flipped: false) { r in
  for (i, (bg, fg)) in [(NSColor(white: 0.96, alpha: 1), NSColor.black), (NSColor(white: 0.13, alpha: 1), NSColor.white)].enumerated() {
    let rect = NSRect(x: 0, y: CGFloat(1 - i) * band * s, width: r.width, height: band * s)
    bg.setFill(); rect.fill()
    let tinted = NSImage(size: glyph.size, flipped: false) { rr in glyph.draw(in: rr); fg.set(); rr.fill(using: .sourceAtop); return true }
    tinted.draw(in: NSRect(x: pad * s, y: rect.minY + (band - glyph.size.height) / 2 * s, width: glyph.size.width * s, height: glyph.size.height * s))
  }
  return true
}
let rep = NSBitmapImageRep(data: out.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "${OUT}/menubar.png"))
`);
  execFileSync('swift', ['-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`, '-module-cache-path', join(home, 'module-cache'), swiftFile], { stdio: 'inherit' });
  console.log(`  ${OUT}/menubar.png`);
} catch (e) {
  console.log(`  (skipped menubar.png: ${e.message.split('\n')[0]})`);
}
// Build the native demo preview from the same Swift source and demo status, with no service/profile.
execFileSync(process.execPath, ['scripts/render-native-screenshots.js', statusPath, home], { stdio: 'inherit' });
rmSync(home, { recursive: true, force: true });
rmSync(profile, { recursive: true, force: true });
