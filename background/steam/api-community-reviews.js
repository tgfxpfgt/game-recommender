/**
 * 游戏雷达 Game Radar - Steam 社区评论浏览页解析 / Community Reviews Parser
 *
 * v14.21.2（用户报告：浮窗"依旧没有显示具体评论"）：appreviews 端点 302 死亡
 * （v14.8 观测）后，简体中文评论**文本**无替代源——商店页只渲染摘要行（百分比/
 * 计数），不内嵌评论文本。实测发现 **steamcommunity 评论浏览页仍活着**：
 *   https://steamcommunity.com/app/<id>/reviews/?browsefilter=recent&language=schinese
 * 每页 10 条完整评论卡（正文/thumbsUp|Down/时长/日期），无需登录（登录墙仅拦
 * "写"操作）——本模块解析其 HTML 供浮窗"简体中文评测"区渲染。
 * Community reviews browse page: the last live keyless source of review TEXT
 * after the appreviews endpoint died; 10 full review cards per page.
 *
 * 注意：steamcommunity.com 与 store.steampowered.com 不同主机——失败计入独立
 * 'steamcommunity' 熔断域（v14.6.2 教训：不连坐 store）；DLC 的 reviews 页会
 * 302 到本体评论枢纽（跟随即可，评论归属本体语义正确）。
 */
import { fetchWithTimeout } from '../core/utils.js';
import { ENDPOINTS, PERF_CONFIG } from '../core/constants.js';
import { recordDomainCall, isCircuitOpen } from '../core/api-monitor.js';
import { Logger } from '../storage/logger.js';
import { recordUsageCounter, recordUsageEvent } from '../storage/usage-evidence.js'; // v14.25.0

// 本 SW 会话内"端点不可用"标记（结构性变更哨兵）：解析零产出时置位，后续
// 调用直接跳过（省请求）；SW 冷启动后重新探测一次。与 appreviewsDead 同构。
let communityReviewsDead = false;

// 会话内抓取去重（同 appId 一次）：评论页抓取较重（~150KB），详情页重渲染/
// 刷新/重检索路径会重复触发——去重后第二次直接复用内存结果。
/** @type {Map<string, {t: number, reviews: Array<{recommended: boolean, text: string, date: string}>}|null>} */
const fetchCache = new Map();
const FETCH_CACHE_TTL_MS = 10 * 60 * 1000; // 10min：浮窗刷新路径够用，评论更新以小时计
const FETCH_CACHE_MAX = 24;

/**
 * 解析社区评论浏览页 HTML（纯函数，可单测）。评论卡结构（2026-11 实测快照）：
 *   <div class="apphub_CardTextContent">
 *     <div class="date_posted">Posted: 9 November, 2023</div>
 *     正文文本…
 *   </div>
 * 推荐方向在卡片前部的 vote_header 里（icon_thumbsUp.png / icon_thumbsDown.png
 * + title 文本）——按卡片级切分（vote_header → apphub_CardTextContent 顺序）
 * 配对。正文块内以 date_posted 行为界，其后非标签文本即正文。
 * @param {string} html
 * @returns {Array<{recommended: boolean, text: string, date: string}>} 无产出 = 空数组
 */
export function parseCommunityReviewsHtml(html) {
  const reviews = [];
  if (typeof html !== 'string' || html.length < 200) return reviews;
  // 卡片 = vote_header（含 thumb 图）… apphub_CardTextContent（含正文） 的顺序块。
  // 以原文偏移切分（matchAll 保 index），每卡正文前回看 3000 字符内最近的
  // thumb 图判定推荐方向。
  const CARD_ANCHOR = 'apphub_CardTextContent';
  const anchors = [...html.matchAll(new RegExp(CARD_ANCHOR, 'g'))];
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].index + CARD_ANCHOR.length;
    const end = i + 1 < anchors.length ? anchors[i + 1].index : Math.min(start + 8000, html.length);
    const seg = html.slice(start, end); // 单卡正文区上限（防异常页拖死）
    // v14.21.2：评论卡必有 date_posted（DLC 的 reviews URL 会 302 到本体 hub
    // 变体页，混入官方公告/事件卡——无日期行即非评论，跳过）
    if (!seg.includes('date_posted')) continue;
    // 推荐方向：正文块之前 3000 字符窗口内最近的 thumb 图（vote_header 先于正文）
    const lookBack = html.slice(Math.max(0, start - 3000), start);
    const upM = lookBack.lastIndexOf('icon_thumbsUp');
    const downM = lookBack.lastIndexOf('icon_thumbsDown');
    // 两个都缺 → 保守归不推荐侧（有正文才产出，方向缺失属结构噪声）
    const recommended = upM >= 0 && upM > downM;
    // 正文：date_posted 行之后到段落内首个闭合标签（即日期行的 </div>）
    const dateM = seg.match(/date_posted[^>]*>([^<]+)</);
    // v14.21.2：日期统一剥 "Posted:"/"发布于：" 前缀（en 页 Posted，zh 变体发布于）
    const date = dateM
      ? decodeEntities(dateM[1])
          .replace(/\s+/g, ' ')
          .replace(/^(Posted:|发布于：)\s*/i, '')
          .trim()
      : '';
    const bodyStart = seg.indexOf('</div>', seg.indexOf('date_posted'));
    if (bodyStart < 0) continue;
    // 正文窗口 = 日期行闭合后 ≤600 字符，且在"下一卡头部标记"处截断——seg
    // 含本卡收尾之后的下一个 vote_header（下卡在正文块**之前**渲染），不截断
    // 会把下卡 vote_header 文本吸进正文
    let bodyEnd = Math.min(bodyStart + 6 + 600, seg.length);
    for (const marker of ['<div class="vote_header"', '<div class="apphub_CardTextContent"']) {
      const mi = seg.indexOf(marker, bodyStart);
      if (mi >= 0 && mi < bodyEnd) bodyEnd = mi;
    }
    const rawBody = seg.slice(bodyStart + 6, bodyEnd);
    let text = decodeEntities(
      rawBody
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
    // v14.21.2：正文内嵌引用块会重复出现 date_posted 行（引用其他评论的
    // 日期）——中段出现即从该处截断；正文开头出现（整卡以引用开头）则剥
    // 引用日期行本身（引用文本保留，仍属评论内容）
    const embedM = text.match(/发布于：|Posted:\s*\d/);
    if (embedM && embedM.index != null && embedM.index > 0) {
      text = text.slice(0, embedM.index).trim();
    } else if (embedM && embedM.index === 0) {
      text = text.replace(/^发布于：[\d\s年月日]+|^Posted:\s*[\d\sA-Za-z,]+/, '').trim();
    }
    if (text.length < 15) continue; // 空/过短正文 = 结构噪声（如已折叠卡）
    reviews.push({ recommended, text: text.slice(0, 200), date });
  }
  return reviews;
}

/** @param {string} s */
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 抓取并解析 appId 的社区简体中文评论（回退链消费方）。
 * 死旗标/熔断短路/会话去重三层护栏；失败静默返回 null（浮窗按无文本降级）。
 * @param {string|number} appId
 * @returns {Promise<Array<{recommended: boolean, text: string, date: string}>|null>} null = 未抓到
 */
export async function fetchCommunityChineseReviews(appId) {
  const key = String(appId || '');
  if (!key || communityReviewsDead) return null;
  const cached = fetchCache.get(key);
  if (cached && Date.now() - cached.t < FETCH_CACHE_TTL_MS) return cached.reviews;
  if (isCircuitOpen('steamcommunity')) return null;
  const url = `${ENDPOINTS.steamCommunityReviews}${encodeURIComponent(key)}/?browsefilter=recent&language=schinese`;
  try {
    const resp = await fetchWithTimeout(
      url,
      { headers: { Accept: 'text/html' } },
      PERF_CONFIG.fetchTimeoutCommunityReviewsMs
    );
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const html = await resp.text();
    const reviews = parseCommunityReviewsHtml(html);
    recordDomainCall('steamcommunity', true);
    if (reviews.length === 0) {
      // 结构变更哨兵：本会话不再打（页面结构漂移时静默降级为无文本，与
      // appreviewsDead 同语义）
      recordUsageEvent('reviews', 'structureDrift'); // v14.25.0：页面结构漂移证据
      communityReviewsDead = true;
      Logger.warn('Steam', '社区评论页解析零产出（结构可能已变更），本会话跳过');
      return null;
    }
    // 会话去重缓存写入（有界：超出按插入序淘汰）
    if (fetchCache.size >= FETCH_CACHE_MAX) {
      const first = fetchCache.keys().next().value;
      if (first !== undefined) fetchCache.delete(first);
    }
    fetchCache.set(key, { t: Date.now(), reviews });
    recordUsageCounter('reviews.communityOk'); // v14.25.0：社区评论回退成功
    Logger.info('Steam', `社区评论回退: ${key} → ${reviews.length} 条简体中文评论`);
    return reviews;
  } catch (e) {
    recordDomainCall('steamcommunity', false);
    recordUsageCounter('reviews.communityFail'); // v14.25.0
    Logger.debug('Steam', '社区评论抓取失败:', String(e));
    return null;
  }
}

// 重置（测试用）/ reset for tests
export function resetCommunityReviewsState() {
  communityReviewsDead = false;
  fetchCache.clear();
}
