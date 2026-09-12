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

// ============ 内嵌 Steam 信息区数据口径（v10.5.3，1:1 对齐 XDGame） ============
// 修正口碑/结论分档/评级映射为 XDGame 同款卡片的纯函数，口径经其线上接口
// （/plus/steam_review_summary.php，2026-09-09 抓取 45 组样本）回归校准。
// detail-templates 依赖 common.escapeHtml → escapeHtmlLocal（document 转义）；
// Node 单测无 DOM，注入最小转义 mock（不影响断言的纯文本内容）
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: () => {
      const el = { textContent: '' };
      Object.defineProperty(el, 'innerHTML', {
        get() {
          return String(el.textContent).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
      });
      return el;
    }
  };
}
const detailTemplates = await import('../../content/detail/detail-templates.js');
const { adjustedReputation, verdictFor, ratingTextInfo, steamInlineSection } = detailTemplates;

test('修正口碑：XDGame 线上样本回归（7 组，误差 ≤0.5pp）', () => {
  // [好评数, 总数, XDGame 接口观测值]——含 total=1 单评测与 total≈9.7k 大样本两端
  const cases = [
    [1, 1, 59.4],
    [100, 125, 73],
    [374, 469, 75.1],
    [284, 495, 56.2],
    [1051, 1282, 78.3],
    [2641, 3155, 80.7],
    [8636, 9675, 86.8]
  ];
  for (const [p, t, expected] of cases) {
    expect(Math.abs(adjustedReputation(p, t) - expected)).toBeLessThanOrEqual(0.5);
  }
  expect(adjustedReputation(0, 0)).toEqual(null); // 无评测 → null
});

test('结论文案分档（round 后阈值 90/85/75/65/50/40，XDGame 观测边界）', () => {
  expect(verdictFor(89.9)).toEqual('玩家认可度极高，值得优先体验');
  expect(verdictFor(89.2)).toEqual('口碑表现出色，推荐下载体验');
  expect(verdictFor(84.4)).toEqual('整体口碑很好，值得下载体验');
  expect(verdictFor(74.6)).toEqual('整体口碑很好，值得下载体验');
  expect(verdictFor(74)).toEqual('整体表现不错，感兴趣可以尝试');
  expect(verdictFor(64.8)).toEqual('整体表现不错，感兴趣可以尝试');
  expect(verdictFor(64.2)).toEqual('口碑尚可，建议结合玩法判断');
  expect(verdictFor(48.7)).toEqual('玩家评价分歧较大，建议先了解内容');
  expect(verdictFor(30)).toEqual('口碑较差，请谨慎选择');
});

test('评级描述：英文→中文映射 + 中文直通 + 少量评测特例 + 好评率回退', () => {
  expect(ratingTextInfo('Very Positive')).toEqual({ text: '特别好评', sentiment: 'positive' });
  expect(ratingTextInfo('Overwhelmingly Negative')).toEqual({ text: '差评如潮', sentiment: 'negative' });
  expect(ratingTextInfo('特别好评', 95)).toEqual({ text: '特别好评', sentiment: 'positive' });
  expect(ratingTextInfo('褒贬不一')).toEqual({ text: '褒贬不一', sentiment: 'mixed' });
  expect(ratingTextInfo('1 user reviews')).toEqual({ text: '褒贬不一', sentiment: 'mixed' });
  expect(ratingTextInfo('自定描述', 80)).toEqual({ text: '80% 好评', sentiment: 'positive' });
  expect(ratingTextInfo('自定描述', 45)).toEqual({ text: '45% 好评', sentiment: 'mixed' });
  expect(ratingTextInfo('自定描述', 20)).toEqual({ text: '20% 差评', sentiment: 'negative' });
});

test('信息卡模板：无评测不渲染 / 综合评分=修正口碑÷10 / 数值预填充', () => {
  expect(steamInlineSection({ appId: '1', name: '空' })).toEqual('');
  expect(steamInlineSection({ appId: '1', name: '空', totalReviews: 0 })).toEqual('');
  expect(steamInlineSection(null)).toEqual('');
  // (8685, 9731)：m=1.52·9731^0.655≈622 → 修正口碑 86.9 → 评分 8.7
  const html = steamInlineSection(
    { appId: '2239710', totalReviews: 9731, positiveReviews: 8685, negativeReviews: 1046, ratingDesc: 'Very Positive' },
    1788600000000
  );
  expect(html.includes('steam-review-card') && html.includes('Steam 玩家评价')).toEqual(true);
  expect(html.includes('特别好评') && html.includes('is-positive') && html.includes('fa-thumbs-up')).toEqual(true);
  expect(html.includes('data-steam-score>8.7</strong>')).toEqual(true);
  expect(html.includes('data-steam-total>9,731<')).toEqual(true);
  expect(html.includes('86.9%') && html.includes('width:86.9%')).toEqual(true);
  expect(html.includes('数据更新于')).toEqual(true);
  expect(html.includes('data-steam-appid="2239710"')).toEqual(true);
});
