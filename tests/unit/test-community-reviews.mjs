import { test, expect, beforeEach } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：社区评论浏览页解析（v14.21.2）
 *
 * parseCommunityReviewsHtml：appreviews 端点 302 死亡后简体中文评论**正文**
 * 的替代源——steamcommunity 评论浏览页每页 10 条评论卡。合成样本对齐
 * 2026-11 真实页面快照（vote_header → apphub_CardTextContent → date_posted
 * → 正文；含引用块重复日期行与官方公告卡两类结构噪声）。
 * fetchCommunityChineseReviews：死旗标/会话去重/熔断三层护栏 + 空产出哨兵。
 */
('use strict');
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { installFetchMock } from '../helpers/fetch-mock.mjs';

await import('../../shared/escape.js');
const storage = createStorageMock();
installChromeStorageMock(storage);
globalThis.window = globalThis.window || {};
globalThis.location = globalThis.location || { href: 'http://test/', search: '', origin: 'http://test' };
globalThis.chrome = globalThis.chrome || { runtime: { getManifest: () => ({ version: '0-test' }) } };

const mod = await import('../../background/steam/api-community-reviews.js');
const { parseCommunityReviewsHtml, fetchCommunityChineseReviews, resetCommunityReviewsState } = mod;

// 合成评论卡（2026-11 真实结构对齐）：推荐方向 thumb 图 → 正文卡（日期行 + 正文）
function card(recommended, date, body, extraHead = '') {
  const thumb = recommended ? 'icon_thumbsUp.png?v=1' : 'icon_thumbsDown.png?v=1';
  const title = recommended ? 'Recommended' : 'Not Recommended';
  return (
    `<div class="vote_header"><div class="reviewInfo"><div class="thumb"><img src="https://community.fastly.steamstatic.com/public/shared/images/userreviews/${thumb}">` +
    `</div><div class="title">${title}</div><div class="hours">235.3 hrs on record</div></div></div>` +
    extraHead +
    `<div class="apphub_CardTextContent"><div class="date_posted">发布于：${date}</div>${body}</div>`
  );
}

beforeEach(() => {
  resetCommunityReviewsState();
});

test('parseCommunityReviewsHtml：提取推荐方向/日期/正文（真实结构）', () => {
  const html =
    '<html>' +
    card(true, '2023 年 11 月 9 日', '画面顶级的射击游戏，手感一流，剧情也在线，值得入手。') +
    card(false, '2023 年 1 月 27 日', '服务器随机断线，击杀敌人召唤断线，高Ping对局体验极差，不推荐现在购买。') +
    '</html>';
  const reviews = parseCommunityReviewsHtml(html);
  expect(reviews.length).toEqual(2);
  expect(reviews[0]).toEqual({
    recommended: true,
    text: '画面顶级的射击游戏，手感一流，剧情也在线，值得入手。',
    date: '2023 年 11 月 9 日'
  });
  expect(reviews[1].recommended).toBe(false);
  expect(reviews[1].date).toEqual('2023 年 1 月 27 日');
});

test('parseCommunityReviewsHtml：官方公告卡（无 date_posted）跳过——DLC hub 变体页混入噪声', () => {
  const html =
    '<html>' +
    // hub 变体页的公告卡：正文块但无 date_posted
    '<div class="apphub_CardTextContent">The Season 1 Battle Pass is packed with 100+ Rewards, including a new Operator.</div>' +
    card(true, '2022 年 11 月 29 日', '枪械顶级的射击体验，画质提升明显，值得尝试的正统续作。') +
    '</html>';
  const reviews = parseCommunityReviewsHtml(html);
  expect(reviews.length).toEqual(1);
  expect(reviews[0].recommended).toBe(true);
});

test('parseCommunityReviewsHtml：正文内嵌引用块——中段日期截断/开头日期剥除', () => {
  const html =
    '<html>' +
    // 中段引用：截断后正文不含"发布于："（截断剩余需 ≥15 字符）
    card(
      true,
      '2023 年 6 月 12 日',
      '前半段战役体验极佳，节奏张弛有度。发布于：2022 年 11 月 29 日 后半段内容空洞，不推荐。'
    ) +
    // 开头引用（整卡以引用开头）：剥引用日期行本身，引用文本保留
    card(false, '2023 年 12 June, 2023', '发布于：2022 年 11 月 29 日 枪械是顶级的，画质是提升的，闪退是经常的。') +
    '</html>';
  const reviews = parseCommunityReviewsHtml(html);
  expect(reviews.length).toEqual(2);
  expect(reviews[0].text).toEqual('前半段战役体验极佳，节奏张弛有度。');
  expect(reviews[1].text).toEqual('枪械是顶级的，画质是提升的，闪退是经常的。');
});

test('parseCommunityReviewsHtml：en 页 Posted: 前缀剥除', () => {
  // en 形态：date_posted 内容为 "Posted: ..."
  const htmlEn =
    '<html><div class="vote_header"><img src="x_icon_thumbsDown.png"></div>' +
    '<div class="apphub_CardTextContent"><div class="date_posted">Posted: 9 November, 2023</div>' +
    'Microtransactions ruin the overall experience badly.</div></html>';
  const reviews = parseCommunityReviewsHtml(htmlEn);
  expect(reviews.length).toEqual(1);
  expect(reviews[0].date).toEqual('9 November, 2023');
});

test('parseCommunityReviewsHtml：畸形输入安全 + 过短正文跳过', () => {
  expect(parseCommunityReviewsHtml('')).toEqual([]);
  expect(parseCommunityReviewsHtml(null)).toEqual([]);
  expect(parseCommunityReviewsHtml(12345)).toEqual([]);
  // 过短正文（<15 字符）= 结构噪声
  const html = '<html>' + card(true, '2023 年 1 月 1 日', '好') + '</html>';
  expect(parseCommunityReviewsHtml(html)).toEqual([]);
});

test('fetchCommunityChineseReviews：抓取→解析→会话去重（第二次零请求）', async () => {
  const html =
    '<html>' +
    card(true, '2023 年 11 月 9 日', '优秀的战术射击体验，团队配合至关重要，强烈推荐给系列粉丝。') +
    card(false, '2023 年 1 月 27 日', '优化问题严重，频繁闪退影响体验，等待后续补丁再考虑购买。') +
    '</html>';
  let fetchCount = 0;
  const restore = installFetchMock(async (url) => {
    fetchCount++;
    return {
      ok: true,
      status: 200,
      redirected: false,
      url: String(url),
      json: async () => ({}),
      text: async () => html
    };
  });
  try {
    const r1 = await fetchCommunityChineseReviews('900021');
    expect(r1 && r1.length).toEqual(2);
    expect(r1[0].recommended).toBe(true);
    expect(r1[1].recommended).toBe(false);
    const countAfterFirst = fetchCount;
    const r2 = await fetchCommunityChineseReviews('900021');
    expect(r2 && r2.length).toEqual(2);
    expect(fetchCount).toEqual(countAfterFirst); // 会话去重：零新请求
  } finally {
    restore();
  }
});

test('fetchCommunityChineseReviews：解析零产出 → 死旗标置位，后续调用不再发请求', async () => {
  let fetchCount = 0;
  const restore = installFetchMock(async (url) => {
    fetchCount++;
    return {
      ok: true,
      status: 200,
      redirected: false,
      url: String(url),
      json: async () => ({}),
      text: async () => '<html>noise only no cards</html>'
    };
  });
  try {
    const r1 = await fetchCommunityChineseReviews('900022');
    expect(r1).toEqual(null);
    expect(fetchCount).toEqual(1);
    const r2 = await fetchCommunityChineseReviews('900023');
    expect(r2).toEqual(null);
    expect(fetchCount).toEqual(1); // 死旗标：本会话跳过
  } finally {
    restore();
  }
});

test('fetchCommunityChineseReviews：网络失败 → null + 不置死旗标（下个 appId 可重试）', async () => {
  const restore = installFetchMock(async () => {
    throw new Error('network down');
  });
  try {
    const r1 = await fetchCommunityChineseReviews('900024');
    expect(r1).toEqual(null);
    // 失败不置死旗标——新 appId 仍会尝试（仅零产出/结构变更才置位）
    const r2 = await fetchCommunityChineseReviews('900025');
    expect(r2).toEqual(null);
  } finally {
    restore();
  }
});
