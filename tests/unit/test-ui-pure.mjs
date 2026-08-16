/**
 * 游戏雷达 Game Radar - 测试：UI 纯函数（v9.3.0 抽取）
 * Free-games filter / serial save queue / LLM response parsing.
 */
import { test, expect } from 'vitest';

await import('../../shared/freegames-filter.js'); // 全局注入（IIFE 挂 __GR_FG_FILTER__）
const { filterFreeGames } = globalThis.__GR_FG_FILTER__ || {};
const settingsUtils = await import('../../shared/settings-utils.js');
const { parseLlmMatchResponse } = await import('../../background/steam/ai-fallback.js');

// ============ freegames 双层过滤 ============
const GAMES = [
  { name: 'A', platform: 'epic', claimType: 'direct' },
  { name: 'B', platform: 'steam', claimType: 'thirdparty' },
  { name: 'C', platform: 'gog', claimType: 'direct' },
  { name: 'D', platform: 'other' },
  { name: 'E', platform: 'epic', claimType: 'thirdparty' }
];

test('全部平台不过滤', () => {
  expect(filterFreeGames(GAMES, 'all', 'all').length).toEqual(5);
});
test('平台过滤（epic）', () => {
  const r = filterFreeGames(GAMES, 'epic', 'all');
  expect(r.map((g) => g.name)).toEqual(['A', 'E']);
});
test('other 平台（排除四主平台）', () => {
  const r = filterFreeGames(GAMES, 'other', 'all');
  expect(r.map((g) => g.name)).toEqual(['D']);
});
test('领取方式过滤（thirdparty）', () => {
  const r = filterFreeGames(GAMES, 'all', 'thirdparty');
  expect(r.map((g) => g.name)).toEqual(['B', 'E']);
});
test('双层过滤（epic + thirdparty）', () => {
  const r = filterFreeGames(GAMES, 'epic', 'thirdparty');
  expect(r.map((g) => g.name)).toEqual(['E']);
});
test('默认领取方式 direct（缺省字段）', () => {
  const r = filterFreeGames([{ name: 'X', platform: 'gog' }], 'gog', 'thirdparty');
  expect(r.length).toEqual(0);
});

// ============ 串行保存队列（并发防覆盖） ============
test('保存队列串行执行（后写覆盖前写的正确性）', async () => {
  const utils = settingsUtils.__GR_SETTINGS_UTILS__ || globalThis.__GR_SETTINGS_UTILS__;
  const createSaveQueue = utils.createSaveQueue;
  const writes = [];
  const send = async (patch) => {
    writes.push(patch);
    return { success: true };
  };
  const enqueue = createSaveQueue(send);
  // 并发入队两个补丁——串行队列保证按序执行且各自读最新
  const p1 = enqueue(
    async () => ({ a: 1 }),
    null,
    async (latest, patch) => send({ ...patch, latest })
  );
  const p2 = enqueue(
    async () => ({ a: 1, b: 2 }),
    null,
    async (latest, patch) => send({ ...patch, latest })
  );
  await Promise.all([p1, p2]);
  expect(writes.length).toEqual(2);
});

// ============ LLM 匹配响应解析 ============
test('parseLlmMatchResponse 合法 JSON', () => {
  const r = parseLlmMatchResponse('{"name": "北方之魂", "appid": 1213700}');
  expect(r && r.name).toEqual('北方之魂');
  expect(r && r.appId).toEqual(1213700);
});
test('parseLlmMatchResponse 代码块包裹', () => {
  const r = parseLlmMatchResponse('前缀 ```json{"name":"Test Game","appid":12345}``` 后缀');
  expect(r && r.appId).toEqual(12345);
});
test('parseLlmMatchResponse 坏 JSON 容错', () => {
  expect(parseLlmMatchResponse('not json at all')).toEqual(null);
  expect(parseLlmMatchResponse('')).toEqual(null);
});
test('parseLlmMatchResponse 字段缺失返回 null', () => {
  expect(parseLlmMatchResponse('{"foo": "bar"}')).toEqual(null);
});
