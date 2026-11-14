/**
 * game-radar v2 — Service Worker 入口
 * SW entry: typed router + provider wiring. Provider picked at build time
 * (production = steam; e2e variant = fixture for deterministic badges).
 */
import { Router } from '../messaging/router.js';
import { Pipeline } from '../steam/pipeline.js';
import { createSteamProvider } from '../steam/providers/steam.js';
import { fixtureProvider } from '../steam/providers/fixture.js';

/** 构建期注入（build.mjs define）：steam（生产）| fixture（e2e 确定性） */
declare const __GR_PROVIDER__: 'steam' | 'fixture';

const provider =
  __GR_PROVIDER__ === 'fixture'
    ? fixtureProvider
    : createSteamProvider({
        fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args)
      });

const pipeline = new Pipeline(provider);
const router = new Router();

router.register('badges/resolve', async (req) => {
  const results = await pipeline.resolve(req.titles);
  return { results };
});

router.register('stats/get', () => ({ stats: pipeline.getStats() }));

router.register('settings/get', () => ({ settings: { theme: 'steam-dark' } }));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  router
    .listener()(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e instanceof Error ? e.message : String(e) }));
  return true; // async response
});
