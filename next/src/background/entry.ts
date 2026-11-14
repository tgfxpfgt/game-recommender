/**
 * game-radar v2 — Service Worker 入口
 * SW entry: typed router + pipeline wiring. ESM single file via esbuild.
 */
import { Router } from '../messaging/router.js';
import { Pipeline } from '../steam/pipeline.js';
import { fixtureProvider } from '../steam/providers/fixture.js';

const pipeline = new Pipeline(fixtureProvider);
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

// SW 醒来即预热管线（fixture 表常驻内存，真源接入后此处做目录预热）
void pipeline;
