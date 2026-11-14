/**
 * game-radar v2 — Service Worker 入口
 * SW entry: typed router + pipeline/provider/MC wiring. Provider picked at
 * build time (production = steam; e2e variant = fixture for deterministic
 * badges; fixture MC = deterministic 85).
 */
import { Router } from '../messaging/router.js';
import { Pipeline } from '../steam/pipeline.js';
import { createSteamProvider } from '../steam/providers/steam.js';
import { fixtureProvider } from '../steam/providers/fixture.js';
import { createMetacritic } from '../steam/metacritic.js';

/** 构建期注入（build.mjs define）：steam（生产）| fixture（e2e 确定性） */
declare const __GR_PROVIDER__: 'steam' | 'fixture';

const provider =
  __GR_PROVIDER__ === 'fixture'
    ? fixtureProvider
    : createSteamProvider({
        fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args)
      });

// MC 源：生产 = metacritic.com 真源（net 层守卫）；fixture 变体 = 确定性 85
const mc =
  __GR_PROVIDER__ === 'fixture'
    ? { score: async (_name: string) => 85 as number | null }
    : createMetacritic({ fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args) });

const pipeline = new Pipeline(provider, mc);
const router = new Router();

router.register('badges/resolve', async (req) => {
  const results = await pipeline.resolve(req.titles);
  return { results };
});

router.register('detail/get', async (req) => {
  const detail = await pipeline.detail(req.title);
  return { detail };
});

router.register('platform/declare', async (req) => {
  return await pipeline.declarePlatform(req.title, req.platformId);
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
