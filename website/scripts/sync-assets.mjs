// Only checked-in/demo product assets are copied. Never inspect a runtime data directory.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = fileURLToPath(new URL('../public/', import.meta.url));
mkdirSync(join(out, 'images'), { recursive: true });
mkdirSync(join(out, 'providers'), { recursive: true });
for (const file of ['dashboard-dark.png', 'dashboard-light.png', 'panel-dark.png', 'settings-dark.png', 'menubar.png', 'icon.png']) {
  copyFileSync(join(root, 'docs/images', file), join(out, 'images', file));
}
copyFileSync(join(root, 'assets/icon.svg'), join(out, 'icon.svg'));
const source = readFileSync(join(root, 'server/public/app.js'), 'utf8');
for (const match of source.matchAll(/^\s*(?:'([^']+)'|(\w+)):\s*`(<svg[^`]+)`/gm)) {
  const id = match[1] || match[2];
  const svg = match[3].replace('class="provider-icon"', 'xmlns="http://www.w3.org/2000/svg"').replace('aria-hidden="true"', '').replaceAll('<path ', '<path fill="currentColor" ');
  writeFileSync(join(out, 'providers', `${id}.svg`), svg);
}
console.log('Synced demo screenshots, app icon and provider SVGs.');
