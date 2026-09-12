import { test, expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：Steam250 榜单解析（v10.4.4）
 *
 * parseSteam250Html：以商店链接切分榜单行，提取排名/评分/评价数；
 * 数量下限哨兵（结构变更弃用）。合成样本模拟 steam250 服务端渲染结构。
 */
('use strict');

const mod = await import(new URL('../../background/steam/steam250.js', import.meta.url).href + '?t=' + Date.now());
const { parseSteam250Html } = mod;

// 合成 steam250 top250 页面片段（排名 #N → 名称 → 评分 → 评价数 → 商店链接）
function row(rank, appid, score, votes, name) {
  // 结构对齐真实 steam250 行：排名 → 名称 → 评分 → 评价数 → 价格 → Actions 商店链接（行尾）
  return `<li><span class="rank">#${rank}</span><span>${name}</span><span>${score}</span><span>${votes} reviews</span><span>$9.99</span><a href="https://store.steampowered.com/app/${appid}?curator_clanid=1">Steam ↗</a></li>`;
}

test('parseSteam250Html：提取排名/评分/评价数并按 appId 建映射', () => {
  const html = `<html><body><ul>${row(1, 413150, '9.93', '1,038,511', 'Stardew Valley')}${row(
    2,
    105600,
    '9.87',
    '512,000',
    'Terraria'
  )}</ul></body></html>`;
  const games = parseSteam250Html(html);
  expect(games['413150']).toEqual({ rank: 1, score: 9.93, votes: 1038511 });
  expect(games['105600']).toEqual({ rank: 2, score: 9.87, votes: 512000 });
});

test('parseSteam250Html：小样本正常解析（数量下限哨兵在 ensureLoaded）', () => {
  const html = `<ul>${row(1, 413150, '9.93', '1,000', 'Stardew Valley')}</ul>`;
  const games = parseSteam250Html(html);
  expect(games['413150'] && games['413150'].rank).toEqual(1);
});

test('parseSteam250Html：畸形输入安全', () => {
  expect(parseSteam250Html('')).toEqual({});
  expect(parseSteam250Html(null)).toEqual({});
  expect(parseSteam250Html(12345)).toEqual({});
});

test('parseSteam250Html：越界排名/评分被过滤', () => {
  const html = `<ul>${row(5000, 111, '9.00', '500', 'X')}${row(3, 222, '99.00', '500', 'Y')}</ul>`;
  expect(parseSteam250Html(html)).toEqual({});
});
