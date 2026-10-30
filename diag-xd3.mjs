import { readFileSync } from 'node:fs';
import { createStorageMock, installChromeStorageMock } from './tests/helpers/storage-mock.mjs';
import { installFetchMock } from './tests/helpers/fetch-mock.mjs';

await import('./shared/escape.js');
const storage = createStorageMock();
installChromeStorageMock(storage);
globalThis.window = globalThis.window || {};
globalThis.location = globalThis.location || { href: 'http://test/', search: '', origin: 'http://test' };
globalThis.chrome = globalThis.chrome || { runtime: { getManifest: () => ({ version: '0-test' }) } };

const { parseGameTitle } = await import('./background/core/title-parser.js');
const api = await import('./background/steam/api-search.js');

const d = JSON.parse(readFileSync(new URL('./tests/fixtures/baseline-firstpage.json', import.meta.url), 'utf-8'));
for (const sample of d.samples) {
  const recorded = sample.recorded || {};
  const restore = installFetchMock(async (url) => {
    const u = decodeURIComponent(String(url));
    const m = u.match(/term=([^&]+)/);
    const payload = recorded[m ? m[1] : ''] || { total: 0, items: [] };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  });
  const terms = parseGameTitle(sample.rawTitle);
  console.log('  terms:', JSON.stringify(terms));
  let got = null;
  try {
    const r = await api.searchSteamAppId(terms, sample.rawTitle, null);
    got = r ? String(r.appId) : null;
  } catch {
    got = 'THREW';
  }
  const ok = got === String(sample.expectedAppId);
  if (!ok) {
    console.log(
      'FAIL ' + sample.id + ' [' + sample.rawTitle.slice(0, 40) + '] got=' + got + ' want=' + sample.expectedAppId
    );
  } else {
    console.log('ok   ' + sample.id);
  }
  restore();
}
