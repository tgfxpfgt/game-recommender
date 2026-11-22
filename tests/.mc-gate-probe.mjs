// MC 开关关闭 → fetchMetacriticDetails 直接 null（零出站）验证
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { createFetchMock, installFetchMock } from './helpers/fetch-mock.mjs';
installChromeStorageMock(createStorageMock());
const fm = createFetchMock({ '/game/test-game/': '<html>{"ratingValue": 74}</html>' });
installFetchMock(fm);
const settings = await import('../core/settings.js');
const { dataStore } = await import('../../data/data-store.js');
const { DB_KEYS } = await import('../core/constants.js');
await settings.saveSettings?.({ dataSources: { metacritic: false } }).catch?.(() => {});
// 直接写 settings 存储（saveSettings 走 handler 不在此层）
const cur = await import('../core/constants.js');
const dsMod = await import('../../data/data-store.js');
await dataStore.writeModule(DB_KEYS.SETTINGS, { dataSources: { metacritic: false } }).catch(async () => {
  await dataStore.writeModule('settings', { dataSources: { metacritic: false } });
});
const api = await import('../steam/api-metacritic.js');
const score = await api.fetchMetacriticScore('Test Game');
console.log('关闭 MC 后 score:', score, '| 出站调用:', fm._calls.length);
