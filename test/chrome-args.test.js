import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeProfileArgs } from '../server/src/headless/chrome.js';

test('Chrome profile launches avoid macOS app maintenance without bypassing browser security', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const args = chromeProfileArgs('/tmp/profile with spaces', platform);
    assert.ok(args.includes('--user-data-dir=/tmp/profile with spaces'));
    assert.equal(args.includes('--disable-features=MacAppCodeSignClone'), platform === 'darwin');
    assert.ok(!args.some((arg) => /no-sandbox|disable-web-security|ignore-certificate-errors/.test(arg)));
  }
});
