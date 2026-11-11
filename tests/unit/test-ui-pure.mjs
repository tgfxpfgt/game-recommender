/**
 * 游戏雷达 Game Radar - 测试：UI 纯函数（v9.3.0 抽取）
 * Free-games filter / serial save queue / LLM response parsing.
 */
import { test, expect } from 'vitest';

await import('../../shared/freegames-filter.js'); // 全局注入（IIFE 挂 __GR_FG_FILTER__）
await import('../../shared/patterns.js'); // v10.9：steamSidebar 依赖 __GR_PATTERNS__（运行时由 manifest 注入）
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

// ============ v10.9：steamSidebar 跨边界字段归一化（旧缓存异型不崩） ============
test('steamSidebar 旧缓存异型字段不崩且无 NaN（v10.9 回归）', () => {
  const html = detailTemplates.steamSidebar(
    {
      appId: '1213700',
      name: '测试游戏',
      positiveRate: '90', // 字符串数字（旧缓存形态）
      totalReviews: 100,
      reviews: 'not-array', // 异型
      userTags: {},
      genres: null,
      developers: 42,
      description: { obj: 1 }
    },
    Date.now(),
    true,
    false
  );
  expect(typeof html).toEqual('string');
  expect(html.length).toBeGreaterThan(100);
  expect(html.includes('NaN')).toEqual(false);
  expect(html.includes('[object Object]')).toEqual(false);
});
test('steamSidebar 正常数据回归（归一化不改变行为）', () => {
  const html = detailTemplates.steamSidebar(
    {
      appId: '1213700',
      name: '测试游戏',
      positiveRate: 90,
      totalReviews: 100,
      reviews: [{ text: '很好玩', timestamp: Date.now() }],
      userTags: ['RPG'],
      genres: ['角色扮演'],
      developers: ['测试社'],
      description: '一段介绍'
    },
    Date.now(),
    false,
    false
  );
  expect(html.includes('很好玩')).toEqual(true);
  expect(html.includes('RPG')).toEqual(true);
  expect(html.includes('测试社')).toEqual(true);
  expect(html.includes('一段介绍')).toEqual(true);
});

// ============ v10.9.4：标签链接 slug 语言段小写 zh-cn（大写 zh-CN 被 Steam 路由弹回首页） ============
test('steamSidebar 标签链接使用 zh-cn 小写语言段（v10.9.4 回归）', () => {
  const html = detailTemplates.steamSidebar(
    {
      appId: '570',
      name: 'Dota 2',
      positiveRate: 82,
      totalReviews: 1000,
      userTags: ['多人', '策略']
    },
    Date.now(),
    false,
    false
  );
  expect(html.includes('/tags/zh-CN/')).toEqual(false); // 大写 CN 不再出现
  expect(html.includes('/tags/zh-cn/')).toEqual(true);
  expect(html.includes(encodeURIComponent('多人'))).toEqual(true); // 中文 slug 全量编码
  expect((html.match(/tags\/zh-cn\//g) || []).length).toEqual(2); // 每个标签一个链接
});

// ============ v14.22.2：异步数据行锚点独立于 spy 模块（用户报告"浮窗缺 Steam250 排名信息"） ============
// gr-steam250-row/gr-series-row/gr-itad-row/gr-fav-row 四锚点原嵌在 SteamSpy
// 块内——options 关闭 SteamSpy 模块会把四行一并带走。提出常驻块后 spy 开关
// 只管 spy 本体；行默认 display:none、数据就绪才显示。
test('steamSidebar 关闭 spy 模块仍输出 Steam250/系列/ITAD/收藏行锚点（v14.22.2 回归）', () => {
  const html = detailTemplates.steamSidebar(
    {
      appId: '570',
      name: 'Dota 2',
      positiveRate: 82,
      totalReviews: 1000,
      floatModules: { spy: false }
    },
    Date.now(),
    false,
    false
  );
  expect(html.includes('gr-detail-spy')).toEqual(false); // spy 面板本体随开关隐藏
  for (const id of ['gr-steam250-row', 'gr-series-row', 'gr-itad-row', 'gr-fav-row']) {
    expect(html.includes(`id="${id}"`)).toEqual(true); // 异步行锚点常驻（独立数据源）
  }
});

// ============ v14.28.7 R4-B3：详情/浮窗/内嵌卡挂匹配置信度（推测必须给依据） ============
test('steamSidebar 推测匹配 → 徽章 + 依据（命中名/来源/平台/原因）', () => {
  const html = detailTemplates.steamSidebar({
    appId: '570',
    name: 'Dota 2',
    positiveRate: 82,
    totalReviews: 1000,
    matchConfidence: 'suspected',
    matchName: 'Dota 2',
    matchSource: '商店检索',
    matchPlatform: '非 PC（主机/移动/云游戏）',
    matchNote: '未能确认是 PC 版本（主机/移动/云游戏同名条目）'
  });
  expect(html).toContain('推测匹配');
  expect(html).toContain('data-match-confidence="suspected"');
  for (const frag of ['Steam 命中「Dota 2」', '来源：商店检索', '平台：非 PC', '未能确认是 PC 版本']) {
    expect(html).toContain(frag);
  }
});

test('steamSidebar 确认匹配低调展示；无置信度字段不渲染（旧缓存/直取路径）', () => {
  const ok = detailTemplates.steamSidebar({
    appId: '570',
    name: 'Dota 2',
    positiveRate: 82,
    matchConfidence: 'confirmed',
    matchNote: '标题一致，平台为 PC，发行年份相符'
  });
  expect(ok).toContain('data-match-confidence="confirmed"');
  expect(ok).toContain('已确认');
  const none = detailTemplates.steamSidebar({ appId: '570', name: 'Dota 2', positiveRate: 82 });
  expect(none).not.toContain('gr-match-confidence');
});

test('steamInlineSection 推测匹配 → 依据行在复刻卡外层（卡结构不变）', () => {
  const html = steamInlineSection({
    appId: '570',
    name: 'Dota 2',
    positiveRate: 82,
    totalReviews: 1000,
    reviews: [{ text: '好玩', timestamp: Date.now() }],
    matchConfidence: 'suspected',
    matchName: 'Dota 2'
  });
  expect(html).toContain('data-match-confidence="suspected"');
  expect(html.indexOf('gr-match-confidence')).toBeGreaterThanOrEqual(0);
  expect(html.indexOf('gr-match-confidence')).toBeLessThan(html.indexOf('steam-review-card'));
});

// ============ v14.10.1：详情浮窗低/零评测原因行（用户需求） ============
const { renderRatingRows } = await import('../../content/detail/render/rating-rows.js');

test('浮窗低评测行：positiveRate null → 灰色原因行（官方语义 + 评测数 + 发售日期）', () => {
  const html = renderRatingRows(
    {
      positiveRate: null,
      ratingDesc: '需要更多用户评测来生成整体评价',
      totalReviews: 3,
      releaseDate: '2026年10月20日'
    },
    null
  );
  expect(html).toContain('Steam 总体');
  expect(html).toContain('需要更多用户评测来生成整体评价');
  expect(html).toContain('共 3 条评测');
  expect(html).toContain('发售于 2026年10月20日');
  expect(html).not.toContain('% 好评');
});

test('浮窗无评测行：total 0 → 暂无用户评测', () => {
  const html = renderRatingRows(
    { positiveRate: null, ratingDesc: '无用户评测', totalReviews: 0, releaseDate: '2026年11月1日' },
    null
  );
  expect(html).toContain('无用户评测');
  expect(html).toContain('暂无用户评测');
  expect(html).toContain('发售于 2026年11月1日');
});

test('浮窗无 desc 兜底：旧缓存无语义 → 暂无评测', () => {
  const html = renderRatingRows({ positiveRate: null, totalReviews: 0 }, null);
  expect(html).toContain('暂无评测');
});

test('浮窗正常评分行不受影响（不渲染灰色行）', () => {
  const html = renderRatingRows({ positiveRate: 87, ratingDesc: '特别好评', totalReviews: 128 }, null);
  expect(html).toContain('87%');
  expect(html).not.toContain('不足 10 篇');
});
