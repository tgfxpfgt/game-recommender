import { test, expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：Steam250 榜单解析（v10.4.4 引入；v14.21.0 重写）
 *
 * parseSteam250Html：以行容器 <div id=N><div class=rank> 切分榜单行（v14.21.0
 * 现行结构——旧锚点 "#N" 文本与 "N reviews" 关键词已随站点重建消失），提取
 * 排名/评分/评价数；数量下限哨兵（结构变更弃用）在 ensureLoaded。
 * 合成样本对齐 2026-11 真实页面快照（含排名变化指示 span 变体）。
 */

const mod = await import(new URL('../../background/steam/steam250.js', import.meta.url).href + '?t=' + Date.now());
const { parseSteam250Html } = mod;

// 合成 steam250 top250 行（v14.21.0 现行结构，2026-11 实测快照对齐）：
// 行容器 id=rank → rank 容器（可嵌排名变化指示 span）→ title → score stat →
// votes span → meter → price → actions 商店链接（带 curator 参数）
function row(rank, appid, score, votes, name, trendSpan = '') {
  return (
    `<div id=${rank}><div class=rank>${trendSpan} ${rank} </div>` +
    `<div class=title><div><a href=https://club.steam250.com/app/${appid} title="${name}">${name}</a>` +
    `<span title="26 Feb 2016"><span class=date title="26 Feb 2016"><a href=/2016> 2016 </a> </span> </span></div></div>` +
    `<div class="score stat"><span>${score}</span> </div>` +
    `<div class="reviews stat"><span class=votes>${votes}</span>` +
    `<div class="meter rating"><span style="width: 98%"></span> 98% </div></div>` +
    `<div class="price stat"><span> $14.99 </span> </div>` +
    `<div class="actions stat"><a class=store href="https://store.steampowered.com/app/${appid}/?curator_clanid=32686107&amp;utm_source=Steam250 " target=_blank title="Steam store"></a> </div></div>`
  );
}

// 排名变化指示变体（约 1/10 行：<span class=+><span>+1</span> </span> 嵌在
// rank 容器内、排名数字之前——2026-11 实测 rank 40 行原样片段）
const TREND_SPAN = '<span class=+><span>+1</span> </span>';

test('parseSteam250Html：现行结构提取排名/评分/评价数并按 appId 建映射', () => {
  const html = `<section class="applist compact"><div>${row(
    1,
    413150,
    '9.94',
    '1,050,323',
    'Stardew Valley'
  )}${row(2, 105600, '9.93', '1,568,664', 'Terraria')}</div></section>`;
  const games = parseSteam250Html(html);
  expect(games['413150']).toEqual({ rank: 1, score: 9.94, votes: 1050323 });
  expect(games['105600']).toEqual({ rank: 2, score: 9.93, votes: 1568664 });
});

test('parseSteam250Html：排名变化指示 span 变体（rank 数字前嵌 +/-N）正常解析', () => {
  const html = `<div>${row(40, 1222140, '9.74', '270,048', 'Detroit: Become Human', TREND_SPAN)}</div>`;
  const games = parseSteam250Html(html);
  expect(games['1222140']).toEqual({ rank: 40, score: 9.74, votes: 270048 });
});

test('parseSteam250Html：旧结构（#N 文本 + N reviews 关键词）不再解析出条目', () => {
  // 站点重建前的旧行形态——新解析器应零产出（防旧锚点垃圾数据复活）
  const legacy =
    '<li><span class="rank">#1</span><span>Stardew Valley</span><span>9.93</span>' +
    '<span>1,038,511 reviews</span><span>$9.99</span>' +
    '<a href="https://store.steampowered.com/app/413150?curator_clanid=1">Steam ↗</a></li>';
  expect(parseSteam250Html(`<ul>${legacy}</ul>`)).toEqual({});
});

test('parseSteam250Html：小样本正常解析（数量下限哨兵在 ensureLoaded）', () => {
  const html = `<div>${row(1, 413150, '9.94', '1,000', 'Stardew Valley')}</div>`;
  const games = parseSteam250Html(html);
  expect(games['413150'] && games['413150'].rank).toEqual(1);
});

test('parseSteam250Html：畸形输入安全', () => {
  expect(parseSteam250Html('')).toEqual({});
  expect(parseSteam250Html(null)).toEqual({});
  expect(parseSteam250Html(12345)).toEqual({});
});

test('parseSteam250Html：越界排名/评分被过滤', () => {
  const html = `<div>${row(5000, 111, '9.00', '500', 'X')}${row(3, 222, '99.00', '500', 'Y')}</div>`;
  expect(parseSteam250Html(html)).toEqual({});
});
