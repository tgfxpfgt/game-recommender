/**
 * 游戏雷达 Game Radar - 列表页徽章域入口 / List-Page Badge Family Entry
 *
 * v5.0.0：由 list-page.js 拆分——徽章创建/插入/三段式渲染/推荐徽章/高亮。
 * v14.5.0 B6：按域拆为 badges/ 目录——本文件 = 主渲染（prependBadge 三段式
 * + a-b 徽章 + 标题变色）与家族 re-export（manifest 装载路径 = 本文件）；
 * working.js（占位/异常/高亮）、rec.js（推荐值）、badge-base.js（createBadge/
 * insertBadges 单点，铁律 12 契约所在）。
 * Badge family entry (B6): main render lives here; the manifest loads this
 * file. working/rec/badge-base are sibling domains.
 */
import { adjustedReputation, verdictFor, ratingTextInfo } from '../../core/steam-rating-logic.js'; // v10.7.0：评分口径单源
import { createBadge, insertBadges } from './badge-base.js';

export { removeItemFromDom, showWorkingBadge, removeWorkingBadge, showErrorBadge, highlightItem } from './working.js';
export { prependRecBadge } from './rec.js';

// 在游戏标题前插入徽章（v3.3.6 三段式：近30天好评率 → 全部好评率 → 最近更新；
// 悬停显示评论数/发行日期；未找到/合集type/无评测保持单徽章；全部徽章可点击跳转）
// v3.3.8：徽章显示开关（badgeVisibility）——关闭某徽章仅跳过渲染，
// 后台数据获取不受影响；关闭"全部好评率"同时停用好评率过滤。
// v5.0.0：settings 参数化（此前读 ratingsJob 闭包）
export function prependBadge(item, rating, settings) {
  const link = item.link;
  if (!link) return;
  if (link.querySelector('.gr-rating-badge')) return; // 防重复 / no duplicates
  const bv = (settings && settings.badgeVisibility) || {};
  const showRecent = bv.recent !== false;
  const showAll = bv.all !== false;
  const showUpdate = bv.update !== false;
  const showScore = bv.score !== false; // v10.5.3：综合评分徽章（默认开）

  const isNotFound = !rating || !rating.appId;
  const isTypeBadge = !isNotFound && rating.type && rating.type !== 'game' && rating.type !== 'demo';
  const rate = rating ? rating.positiveRate : null;

  const badges = [];
  if (isNotFound) {
    badges.push(
      createBadge(link, {
        text: '未找到',
        color: '#666',
        bg: 'rgba(102,102,102,0.08)',
        cls: 'gr-badge-notfound',
        title:
          '未在 Steam 找到该游戏（搜索无匹配结果或查询失败）\n可按 Alt+Shift+G 强制刷新本页重试；负缓存 2h 后自动重查',
        dashed: true
      })
    );
  } else if (isTypeBadge) {
    badges.push(
      createBadge(link, {
        text: rating.type,
        color: '#b48ce0',
        bg: 'rgba(180,140,224,0.12)',
        cls: 'gr-badge-type',
        title: `Steam 条目类型: ${rating.type}（合集/非单个游戏本体，无法获取本体 AppID）`
      })
    );
  } else if (rate === null || rate === undefined) {
    badges.push(
      createBadge(link, {
        text: rating.appId ? `#${rating.appId}` : '暂无',
        color: '#8f98a0',
        bg: 'rgba(143,152,160,0.15)',
        cls: 'gr-rating-badge',
        title: rating.failed
          ? `Steam 已匹配 (AppID ${rating.appId})，好评率获取失败（网络/限流），稍后自动重试`
          : `Steam 已匹配 (AppID ${rating.appId})，暂无评测\n点击跳转 Steam 详情页`,
        clickable: true,
        appId: rating.appId
      })
    );
  } else {
    // 段0：综合评分徽章（v10.5.3，渲染在最前）——与 XDGame 原生「Steam 玩家
    // 评价」完全同口径：综合评分 = 修正口碑 ÷ 10（好评率贝叶斯收缩，参数经
    // XDGame 线上接口回归校准）；好评/差评原始条数随评分缓存按 appId 存取
    // （多站共用），旧缓存缺失时按整数好评率近似回退（同详情页信息卡）。
    // 悬停展示与 XDGame 卡片一致的明细；颜色取其评级胶囊三档（绿/黄/红）。
    if (showScore) {
      const total = rating.totalReviews || 0;
      let positive = typeof rating.positiveReviews === 'number' ? rating.positiveReviews : null;
      if (positive === null && total > 0 && typeof rate === 'number') {
        positive = Math.round((rate / 100) * total); // 旧缓存回退 / legacy fallback
      }
      const adjusted = positive !== null ? adjustedReputation(positive, total) : null;
      if (adjusted !== null) {
        const { text: ratingText, sentiment } = ratingTextInfo(rating.ratingDesc, rate);
        const score = (adjusted / 10).toFixed(1);
        const fmt = (n) => Number(n).toLocaleString('zh-CN'); // 千分位（XDGame 同款）
        const negative =
          typeof rating.negativeReviews === 'number' ? rating.negativeReviews : Math.max(total - positive, 0);
        // XDGame steam-review-level 三档配色（正文/底色同源转化）
        const LEVEL_STYLE = {
          positive: { color: '#2e8660', bg: 'rgba(46,134,96,0.12)' },
          mixed: { color: '#a26c17', bg: 'rgba(162,108,23,0.14)' },
          negative: { color: '#bd545d', bg: 'rgba(189,84,93,0.12)' }
        }[sentiment];
        badges.push(
          createBadge(link, {
            text: `⭐ ${score}`,
            color: LEVEL_STYLE.color,
            bg: LEVEL_STYLE.bg,
            cls: 'gr-score-badge',
            title:
              `Steam 玩家评价：${ratingText}` +
              `\n综合评分 ${score}/10 · 修正口碑 ${adjusted.toFixed(1)}%` +
              `\nSteam 好评率 ${rate}% · ${fmt(total)} 条评价` +
              `\n好评 ${fmt(positive)} · 差评 ${fmt(negative)}` +
              `\n${verdictFor(adjusted)}` +
              `\n点击跳转 Steam 详情页`,
            clickable: true,
            appId: rating.appId
          })
        );
      }
    }
    // 段1：近 30 天好评率（浅蓝固定色；无近期评测 → 灰 —）
    if (showRecent) {
      const recentRate = rating.recentPositiveRate;
      const recentTotal = rating.recentTotalReviews || 0;
      if (recentRate === null || recentRate === undefined) {
        badges.push(
          createBadge(link, {
            text: '—',
            color: '#8f98a0',
            bg: 'rgba(143,152,160,0.1)',
            cls: 'gr-badge-recent',
            title: '近30天暂无评测'
          })
        );
      } else {
        badges.push(
          createBadge(link, {
            text: `${recentRate}%`,
            color: '#66c0f4',
            bg: 'rgba(102,192,244,0.12)',
            cls: 'gr-badge-recent',
            title: `最近30天好评率: ${recentRate}% · ${recentTotal.toLocaleString()} 条评测`
          })
        );
      }
    }
    // 段2：全部好评率（分级色，可点击跳转；v3.4.0 颜色单源 shared/patterns.js；
    // v10.7.0：删除字面量 fallback——patterns.js 与内容脚本同注入必在，假单源是漂移温床）
    if (showAll) {
      const P = globalThis.__GR_PATTERNS__;
      const color = P.ratingColorFor(rate);
      const bg = P.ratingBgFor(rate);
      // v7.4.0：色盲友好——符号前缀（✓ ≥80 / ▲ ≥60 / ✕ <60，与分级色一致）
      // Color-blind friendly: symbol prefix matching the grade colors
      const sym = rate >= 80 ? '✓ ' : rate >= 60 ? '▲ ' : '✕ ';
      badges.push(
        createBadge(link, {
          text: `${sym}${rate}%`,
          color,
          bg,
          cls: 'gr-rating-badge',
          title: `全部好评率: ${rate}%${rating.ratingDesc ? ' (' + rating.ratingDesc + ')' : ''} · ${(rating.totalReviews || 0).toLocaleString()} 条评测\n点击跳转 Steam 详情页`,
          clickable: true,
          appId: rating.appId
        })
      );
    }
    // 段3：最近更新日期（悬停显示发行日期；无数据 → 灰 —，列表页独立获取）
    if (showUpdate) {
      const update = typeof rating.lastUpdate === 'string' ? rating.lastUpdate : ''; // v10.9.1：异型防 [object Object]
      if (update) {
        badges.push(
          createBadge(link, {
            text: `🛠 ${update.length >= 10 ? update.slice(5) : update}`,
            color: '#8f98a0',
            bg: 'rgba(143,152,160,0.1)',
            cls: 'gr-badge-update',
            title: `最近更新: ${update}${rating.releaseDate ? ' · 发行: ' + rating.releaseDate : ''}`
          })
        );
      } else {
        badges.push(
          createBadge(link, {
            text: '—',
            color: '#8f98a0',
            bg: 'rgba(143,152,160,0.1)',
            cls: 'gr-badge-update',
            title: '最近更新获取中...'
          })
        );
      }
    }
  }
  if (badges.length > 0) insertBadges(item, link, badges);

  // v10.1.0：a-b 徽章（AppID 行为统计）——a = 跨站点下载次数，b = 详情页
  // 打开次数；有下载（a>0）绿色、只看不下（a=0 且 b>0）橙色警示。数据随
  // ratings 条目下发（appDownloads/appDetailViews），无记录的条目不渲染。
  // 最后 push → insertBadges 逆序插入 → 渲染在所有徽章最左
  // v10.4.0：标题变红——总好评率与 30 天好评率均大于 redTitleRating（0=关闭）。
  // 红优先于绿（a-b 只看不下）：两者同时满足时高分游戏标红
  const redThreshold = Number(settings && settings.redTitleRating) || 0;
  const isRedTitle =
    redThreshold > 0 &&
    rating &&
    rating.appId &&
    rating.positiveRate != null &&
    rating.recentPositiveRate != null &&
    rating.positiveRate > redThreshold &&
    rating.recentPositiveRate > redThreshold;
  if (isRedTitle) {
    const titleEl = item.titleEl || (item.element && item.element.querySelector('h2, h3, h4, .title, .entry-title'));
    if (titleEl && titleEl.classList) titleEl.classList.add('gr-title-red');
  }

  // v10.3.0：a-b 徽章独立开关（badgeVisibility.appstat，默认开）——关闭仅
  // 不渲染徽章与绿标题，评分数据获取与推荐计算不受影响
  // v10.4.1：位置修正——插到好评率徽章组（最近/全部/更新）之后、推荐值徽章
  // 之前（此前 insertBadges 插到最左，用户要求位于两个好评率徽章后面）。
  // 锚点 = 主渲染 badges 数组的最后一个元素（逆序插入语义下即最右）；
  // 推荐值徽章的选择器以 gr-rating-badge 为基类，会自然接在本徽章之后
  // v10.4.3：所有已解析 appId 的游戏都渲染（原始需求「每个游戏链接增加一个
  // 徽章」）——无行为记录显示 0-0 灰色（让功能可见、可自验证）
  if (bv.appstat !== false && rating && rating.appId) {
    const a = rating.appDownloads || 0;
    const b = rating.appDetailViews || 0;
    const hasDownload = a > 0;
    const hasViews = b > 0;
    const anchorBadge = badges.length > 0 ? badges[badges.length - 1] : null;
    const statBadge = createBadge(link, {
      text: `${a}-${b}`,
      color: hasDownload ? '#4caf50' : hasViews ? '#e67e22' : '#8f98a0',
      bg: hasDownload ? 'rgba(76,175,80,0.12)' : hasViews ? 'rgba(230,126,34,0.14)' : 'rgba(143,152,160,0.12)',
      cls: 'gr-badge-appstat',
      title:
        `下载 ${a} 次 · 详情页打开 ${b} 次（跨站点累计，永不过期）` +
        (hasDownload ? '' : hasViews ? '\n⚠ 只看不下：看的人越多越不推荐' : '\n暂无行为记录：打开详情页/下载后开始计数')
    });
    const statParent = anchorBadge
      ? anchorBadge.parentNode
      : item.titleEl || (item.element && item.element.querySelector('h2, h3, h4, .title, .entry-title')) || link;
    if (anchorBadge && anchorBadge.nextSibling) {
      statParent.insertBefore(statBadge, anchorBadge.nextSibling);
    } else if (anchorBadge) {
      statParent.appendChild(statBadge);
    } else {
      statParent.insertBefore(statBadge, statParent.firstChild);
    }
    // 绿标题：a=0 且 b>0（只看不下）→ 标题变绿提示（红标题优先，content.css）
    if (!hasDownload && b > 0 && !isRedTitle) {
      const titleEl =
        item.titleEl || (item.element && item.element.querySelector('h2, h3, h4, .title, .entry-title')) || null;
      if (titleEl && titleEl.classList) titleEl.classList.add('gr-title-green');
    }
  }
}
