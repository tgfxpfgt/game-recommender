/**
 * 游戏雷达 Game Radar - 详情页浮窗模板 / Detail-Page Float Templates
 *
 * v5.1.0：由 detail-page.js 拆分——纯 HTML 模板函数（无 DOM 绑定），
 * 依赖仅 GR.common（转义/相对时间）。按钮绑定由逻辑层按元素 id 约定完成。
 * Pure HTML template functions split from detail-page.js (v5.1.0); only
 * depends on common. Button binding stays in the logic layer via id
 * conventions.
 */
import * as common from '../core/common.js';
// v10.7.0 批次1：评分口径纯函数下沉 content/core/steam-rating-logic.js（本文件
// 只留模板）；此处 re-export 保持既有 import 路径兼容（detail-page.js 命名空间用法）
import { heatLabelFor, ratingTextInfo, adjustedReputation, verdictFor } from '../core/steam-rating-logic.js';
export { heatLabelFor, ratingTextInfo, adjustedReputation, verdictFor };

const esc = (text) => common.escapeHtml(text);

// Steam 信息栏完整模板（数据 + 缓存时间 + 按钮开关 → HTML）
// Full Steam-info sidebar template (data + cachedAt + button flags → HTML)
export function steamSidebar(data, cachedAt, hasRefresh, hasReport) {
  // v10.9：跨边界字段归一化——旧缓存/异型数据（reviews/userTags/genres/
  // developers/description 为字符串或对象）此前使浮窗整条渲染链抛错。
  // Normalize cross-boundary fields: legacy cache entries may hold wrong types.
  data = { ...data };
  if (!Array.isArray(data.reviews)) data.reviews = [];
  if (!Array.isArray(data.userTags)) data.userTags = [];
  if (!Array.isArray(data.genres)) data.genres = [];
  if (!Array.isArray(data.developers)) data.developers = [];
  if (typeof data.description !== 'string') data.description = ''; // 垃圾对象置空（不渲染 [object Object]）
  data.reviews = data.reviews.filter((r) => r && typeof r === 'object' && typeof r.text === 'string'); // 无有效文本的条目直接弃用
  // v12 B4：模块显隐——floatModules 设置（chips/tags/developers/description/spy）
  // 未配置 = 全显示（不破坏现有用户）
  // v13 B3：order 排序持久化——块按 order 数组顺序渲染（未配置 = 默认序）
  const mods = (typeof data.floatModules === 'object' && data.floatModules) || {};
  const DEFAULT_ORDER = ['chips', 'tags', 'developers', 'description', 'spy'];
  const order =
    Array.isArray(mods.order) && mods.order.length > 0 ? mods.order.filter((k) => DEFAULT_ORDER.includes(k)) : [];
  for (const k of DEFAULT_ORDER) if (!order.includes(k)) order.push(k); // 补缺失项（保底）
  // 评级色（v5.0.0：颜色单源 __GR_PATTERNS__；v10.7.0 删字面量 fallback）
  const P = globalThis.__GR_PATTERNS__;
  const rate = Number(data.positiveRate) || 0; // v10.9：非数值防 NaN 进进度条
  // v9.6.0：评分区改 Steam 风格——颜色在 row 内经 colorOf 单源计算（此处不再需要）
  const ratingBg = P.ratingBgFor(rate);

  const cacheAgeText = common.formatRelativeTime(cachedAt);

  // 中文评测
  let reviewsHtml = '';
  if (data.reviews && data.reviews.length > 0) {
    reviewsHtml = `
        <div class="gr-detail-section">
          <div style="font-size:12px;color:#8f98a0;margin-bottom:6px;">🇨🇳 简体中文评测</div>
          ${data.reviews
            .slice(0, 3)
            .map(
              (r) => `
            <div class="gr-detail-review" style="border-left-color:${r.recommended ? '#66c0f4' : '#a34c25'};">
              <span style="color:${r.recommended ? '#66c0f4' : '#a34c25'}">${r.recommended ? '👍 推荐' : '👎 不推荐'}</span>
              <div style="color:#acb2b8;margin-top:3px;word-break:break-all;">${esc(r.text.substring(0, 120))}${r.text.length > 120 ? '...' : ''}</div>
            </div>
          `
            )
            .join('')}
        </div>
      `;
  }

  // SteamSpy 面板（v3.3.6 主数据；v4.0.0 热度等级）
  let spyHtml = '';
  const spy = data.steamspy;
  const hasSpyData =
    spy &&
    ((spy.positiveRate !== null && spy.positiveRate !== undefined) ||
      spy.currentPlayers ||
      spy.owners ||
      spy.averagePlaytime);
  // v10.5.3：等级计算提为模块级 heatLabelFor（与内嵌信息区共用同一口径）
  const spyHeatLabel = () => heatLabelFor(spy);
  let spyBody = '';
  if (hasSpyData) {
    spyBody = `
        <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;">
          ${spy.positiveRate !== null && spy.positiveRate !== undefined ? `<div class="gr-detail-dim">好评率: <span class="gr-detail-blue">${spy.positiveRate}%</span>${spy.reviewCount ? ` · ${esc(spy.reviewCount)} 条` : ''}</div>` : ''}
          ${spy.currentPlayers ? `<div class="gr-detail-dim">当前在线: <span class="gr-detail-green">${esc(spy.currentPlayers)}</span> 人</div>` : ''}
          ${spy.owners ? `<div class="gr-detail-dim">拥有者: <span class="gr-detail-strong">${esc(spy.owners)}</span>${spyHeatLabel() ? ` · 热度 <span class="gr-detail-green">${spyHeatLabel()}</span>` : ''}</div>` : ''}
          ${spy.averagePlaytime ? `<div class="gr-detail-dim">平均时长: <span class="gr-detail-strong">${esc(spy.averagePlaytime)}</span></div>` : ''}
        </div>
      `;
  } else {
    spyBody = `<div class="gr-detail-muted">SteamSpy 数据暂不可用（站点可能启用了人机验证）</div>`;
  }
  spyHtml = `
      <div class="gr-detail-spy">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:12px;font-weight:bold;color:#fff;">📊 SteamSpy</span>
          ${data.steamdbUrl ? `<a href="${common.escapeAttr(data.steamdbUrl)}" target="_blank" style="font-size:11px;color:#67c1f5;text-decoration:none;">SteamDB 查看 ↗</a>` : ''}
        </div>
        ${spyBody}
      </div>
      <div id="gr-steam250-row" style="display:none;margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;color:#8f98a0;line-height:1.6;"></div>
      <div id="gr-itad-row" style="display:none;margin-top:6px;font-size:11px;color:#8f98a0;line-height:1.6;"></div>
      <div id="gr-fav-row" style="display:none;margin-top:6px;font-size:11px;"></div>
    `;

  return `
      <!-- 头部图片 -->
      ${
        data.headerImage
          ? `
        <div style="position:relative;">
          <img id="gr-header-image" class="gr-detail-header-img" src="${common.escapeAttr(data.headerImage)}"/>
        </div>
      `
          : ''
      }

      <div class="gr-detail-content">
        <!-- 游戏名 + Demo/试玩版标识 -->
        <div class="gr-detail-title">
          ${
            data.isDemo || /\b(demo|trial)\b|试玩/i.test((data.name || '') + ' ' + (data.englishName || ''))
              ? `<span style="display:inline-block;padding:2px 8px;margin-right:6px;font-size:11px;font-weight:bold;color:#ff7b00;background:rgba(255,123,0,0.15);border:1px solid #ff7b00;border-radius:3px;vertical-align:middle;">试玩版 / Demo</span>`
              : ''
          }
          ${esc(data.name)}
        </div>

        <!-- 中文支持 + 发行信息 -->
        <div class="gr-detail-tags" ${mods.chips === false ? 'style="display:none;"' : ''}>
          <span style="padding:2px 8px;border-radius:2px;background:${data.chineseSupported ? 'rgba(163,207,6,0.15)' : 'rgba(255,255,255,0.05)'};color:${data.chineseSupported ? '#a3cf06' : '#666'};">
            ${data.chineseSupported ? (data.simplifiedChinese ? '✓ 简体中文' : '✓ 支持中文') : '✗ 暂不支持中文'}
            ${data.chineseSupported && data.chineseHasAudio ? ' · 音频' : ''}
            ${data.chineseSupported && data.chineseHasSubtitles ? ' · 字幕' : ''}
          </span>
          ${data.releaseDate ? `<span class="gr-detail-chip">📅 ${esc(data.releaseDate)}</span>` : ''}
          ${data.lastUpdate ? `<a class="gr-detail-chip" href="${common.escapeAttr('https://store.steampowered.com/news/app/' + (data.appId || ''))}" target="_blank" rel="noopener" title="查看 Steam 公告（v11.0 B5）" style="text-decoration:none;">🛠 更新 ${esc(data.lastUpdate)}</a>` : ''}
          ${(() => {
            // v12 B6：发售倒计时（releaseDate 为未来日期时显示）
            const rd = Date.parse(data.releaseDate || '');
            if (isNaN(rd)) return '';
            const days = Math.ceil((rd - Date.now()) / 86400000);
            if (days <= 0) return '';
            return `<span class="gr-detail-chip" style="background:rgba(103,193,245,0.15);color:#67c1f5;">🚀 ${days <= 30 ? days + ' 天后发售' : esc(data.releaseDate)}</span>`;
          })()}
        </div>

        <!-- 跳转Steam按钮 -->
        ${
          data.url
            ? `<a href="${common.escapeAttr(data.url)}" target="_blank" class="gr-detail-btn">在 Steam 上查看</a>`
            : ''
        }

        <!-- 评分区域 - 四重评价（Steam总体/最近30天/简体中文/SteamSpy） -->
                        <div class="gr-detail-rating-box" style="background:${ratingBg};">
          ${(() => {
            // v9.6.0：Steam 风格评分行——标签 + 好评率条形 + 数字（颜色走单源；
            // 字符串拼接避免嵌套模板转义）
            const P2 = globalThis.__GR_PATTERNS__ || {};
            const colorOf = (v) =>
              P2.ratingColorFor ? P2.ratingColorFor(v) : v >= 80 ? '#66c0f4' : v >= 60 ? '#a3cf06' : '#ff7b00';
            const fmt = (n) => (n === null || n === undefined ? 0 : Number(n).toLocaleString());
            const row = (label, desc, rate, total, color) =>
              '<div class="gr-detail-rate-row">' +
              '<div class="gr-detail-rate-head">' +
              '<span class="gr-detail-rate-label">' +
              label +
              '</span>' +
              '<span class="gr-detail-rate-desc" style="color:' +
              color +
              '">' +
              esc(desc) +
              '</span>' +
              '</div>' +
              '<div class="gr-detail-rate-bar"><div class="gr-detail-rate-fill" style="width:' +
              Math.max(0, Math.min(100, rate)) +
              '%;background:' +
              color +
              '"></div></div>' +
              '<div class="gr-detail-rate-num">' +
              rate +
              '% · ' +
              fmt(total) +
              ' 条评测</div>' +
              '</div>';
            let html = '';
            if (data.positiveRate !== null && data.positiveRate !== undefined) {
              html += row(
                'Steam 总体',
                data.ratingDesc || data.positiveRate + '% 好评',
                data.positiveRate,
                data.totalReviews || 0,
                colorOf(data.positiveRate)
              );
            }
            if (data.recentPositiveRate !== null && data.recentPositiveRate !== undefined) {
              html += row(
                '🕒 最近 30 天',
                data.recentPositiveRate + '% 好评',
                data.recentPositiveRate,
                data.recentTotalReviews || 0,
                colorOf(data.recentPositiveRate)
              );
            }
            if (data.cnPositiveRate !== null && data.cnPositiveRate !== undefined) {
              html += row(
                '🇨🇳 简体中文',
                data.cnRatingDesc || data.cnPositiveRate + '% 好评',
                data.cnPositiveRate,
                data.cnTotalReviews || 0,
                colorOf(data.cnPositiveRate)
              );
            }
            if (data.steamspy && data.steamspy.positiveRate !== null && data.steamspy.positiveRate !== undefined) {
              html += row(
                '📊 SteamSpy',
                data.steamspy.positiveRate + '% 好评',
                data.steamspy.positiveRate,
                data.steamspy.reviewCount || 0,
                '#67c1f5'
              );
            }
            return html;
          })()}
<!-- v4.1.0：综合推荐理由（好评率 70% + 中文 30% 口径 + 热度/时长因子，与推荐引擎同源） -->
          ${(() => {
            let s = 0.4; // 无好评率中性值（对齐引擎 steamScore）
            if (data.positiveRate !== null && data.positiveRate !== undefined) {
              s = Math.min((data.positiveRate / 100) * 0.7 + (data.chineseSupported ? 0.3 : 0), 1);
            }
            const parts = [];
            if (data.positiveRate !== null && data.positiveRate !== undefined)
              parts.push(`好评率 ${data.positiveRate}%`);
            parts.push(data.chineseSupported ? '中文支持' : '暂无中文');
            const heat = spyHeatLabel();
            if (heat) parts.push(`热度 ${heat}`);
            if (spy && spy.averagePlaytime) parts.push(`平均时长 ${spy.averagePlaytime}`);
            return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;color:#acb2b8;">综合推荐 <span class="gr-detail-blue">${Math.round(s * 100)}%</span><span style="color:#8f98a0;">（${parts.join(' · ')}）</span></div>`;
          })()}
        </div>

        <!-- 热门用户自定义标签 -->
        ${
          data.userTags && data.userTags.length > 0 && mods.tags !== false
            ? `
          <div style="margin-bottom:12px;">
            <div style="font-size:12px;color:#8f98a0;margin-bottom:5px;">🔥 热门用户标签</div>
            <div class="gr-detail-flex-wrap">
              ${data.userTags
                .map(
                  (t) =>
                    // v10.4.4：标签可点击跳转 Steam 标签页（新窗口；href 全量编码）
                    `<a href="${common.escapeAttr('https://store.steampowered.com/tags/zh-cn/' + encodeURIComponent(t))}" target="_blank" rel="noopener" title="在 Steam 查看标签「${esc(t)}」" style="padding:3px 8px;font-size:11px;background:rgba(103,193,245,0.12);color:#67c1f5;border-radius:2px;cursor:pointer;text-decoration:none;display:inline-block;">${esc(t)}</a>`
                )
                .join('')}
            </div>
          </div>
        `
            : ''
        }

        <!-- 官方类型标签 -->
        ${
          data.genres && data.genres.length > 0
            ? `
          <div style="margin-bottom:12px;">
            <div style="font-size:12px;color:#8f98a0;margin-bottom:5px;">类型</div>
            <div class="gr-detail-flex-wrap">
              ${data.genres.map((g) => `<span style="padding:3px 8px;font-size:11px;background:rgba(255,255,255,0.06);color:#c7d5e0;border-radius:2px;cursor:default;">${esc(g)}</span>`).join('')}
            </div>
          </div>
        `
            : ''
        }

        <!-- 开发商 -->
        ${
          mods.developers !== false && data.developers && data.developers.length > 0
            ? `
          <div style="font-size:12px;color:#8f98a0;margin-bottom:10px;">开发商: <span style="color:#67c1f5;">${esc(data.developers.join(', '))}</span></div>
        `
            : ''
        }

        <!-- 简介 -->
        ${
          mods.description !== false && data.description
            ? `
          <div style="font-size:12px;color:#acb2b8;margin-bottom:12px;line-height:1.6;max-height:80px;overflow:hidden;">
            ${esc(data.description.substring(0, 200))}${data.description.length > 200 ? '...' : ''}
          </div>
        `
            : ''
        }

        <!-- SteamDB 信息 -->
        ${spyHtml}

        <!-- 中文评测 -->
        ${reviewsHtml}

        <!-- 底部信息栏：App ID + 缓存时间 + 手动更新/报错按钮 -->
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid #2a475e;font-size:11px;color:#8f98a0;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            ${data.appId ? `<span>App ID: <a href="${common.escapeAttr('https://store.steampowered.com/app/' + data.appId)}" target="_blank" style="color:#67c1f5;text-decoration:none;">${esc(String(data.appId))}</a></span>` : '<span>App ID: —</span>'}
            <span title="${cachedAt ? new Date(cachedAt).toLocaleString() : ''}">缓存于 ${cacheAgeText}</span>
          </div>
          ${
            hasRefresh
              ? `
            <button id="gr-refresh-cache-btn" style="
              margin-top:8px;width:100%;padding:7px 0;
              background:linear-gradient(to right,#3a6c8e,#2a475e);
              color:#c7d5e0;border:1px solid #3a6c8e;border-radius:3px;
              cursor:pointer;font-size:12px;font-family:inherit;
              transition:background 0.2s;
            ">🔄 手动更新 Steam 缓存</button>
          `
              : ''
          }
          ${
            hasReport
              ? `
            <button id="gr-report-issue-btn" style="
              margin-top:6px;width:100%;padding:7px 0;
              background:linear-gradient(to right,#8e3a3a,#5e2a2a);
              color:#ffb3b3;border:1px solid #8e3a3a;border-radius:3px;
              cursor:pointer;font-size:12px;font-family:inherit;
              transition:background 0.2s;
            " title="检索到的游戏与页面内容不符？点击清除错误缓存并重新检索">⚠️ 信息有误？重新检索</button>
          `
              : ''
          }
        </div>
      </div>
    `;
}

// ============ v10.5.3 任务1：内嵌 Steam 信息区（1:1 复刻 XDGame） ============
// 用户反馈首版信息卡与 XDGame 原生「Steam 玩家评价」区不一致——本模板改为
// 与 XDGame 详情页完全一致：相同 HTML 结构（steam-review-card 及全部子元素
// /data-steam-* 属性）、相同样式（样式表 1:1 译自其
// article_steam_rating_20260905.css，见 detail-page.js INLINE_SECTION_CSS）、
// 相同数据口径：
//   · 综合评分 = 修正口碑 / 10（一位小数）
//   · 修正口碑 = 好评率经贝叶斯收缩（伪计数 m=1.52·total^0.655，下限 4.3，
//     参数经 XDGame 线上接口 7 组真实样本回归校准，各点误差 ≤0.2pp）
//   · 评级文本 = Steam 官方描述（英文 language=all 返回值映射中文）
//   · 结论文案 = 按四舍五入后的修正口碑分档（≥90/≥85/≥75/≥65/≥50/≥40）
// 无评测（total=0）不渲染——与 XDGame 卡片无数据时隐藏一致。注入与站点门控
// 见 detail-page.js 的 renderInlineSteamSection。
// Inline Steam info card (v10.5.3): pixel-faithful replica of XDGame's native
// "Steam 玩家评价" card — same markup, same stylesheet, same data semantics
// (score = adjusted/10; adjusted = Bayesian-shrunk positive rate calibrated
// against XDGame's live API; verdict banded on the rounded adjusted value).
// Hidden when there are no reviews, exactly like the original.

/**
 * 内嵌 Steam 信息区模板（与 XDGame 原生卡片完全一致，值在渲染时预填充，
 * 保留其 data-steam-* 属性名以保持结构同构）。
 * Inline Steam card markup, a 1:1 replica of XDGame's native card with
 * values pre-filled (data-steam-* attributes kept for structural parity).
 * @param {Object} data - Steam 详情缓存（totalReviews/positiveRate/
 *   positiveReviews/negativeReviews/ratingDesc/appId）
 * @param {number} [cachedAt] - 缓存时间戳（ms）——「数据更新于」行
 * @returns {string} HTML；无评测数据返回空串（不注入）
 */
export function steamInlineSection(data, cachedAt) {
  if (!data) return '';
  // 与 XDGame 一致：无评测（total<=0）不展示 / no reviews → no card
  const total = typeof data.totalReviews === 'number' ? data.totalReviews : 0;
  if (total <= 0) return '';
  // 好评条数：新版缓存直取；旧缓存缺失时按整数好评率近似回退
  let positive = typeof data.positiveReviews === 'number' ? data.positiveReviews : null;
  if (positive === null && typeof data.positiveRate === 'number') {
    positive = Math.round((data.positiveRate / 100) * total);
  }
  if (positive === null || positive < 0) return '';

  const rawPercent = Math.min(Math.max((positive / total) * 100, 0), 100);
  const adjusted = adjustedReputation(positive, total);
  if (adjusted === null) return '';
  const score = (adjusted / 10).toFixed(1); // 综合评分 = 修正口碑/10
  const verdict = verdictFor(adjusted);
  const { text: ratingText, sentiment } = ratingTextInfo(data.ratingDesc, data.positiveRate);
  const levelIcon = sentiment === 'negative' ? 'fa-thumbs-down' : sentiment === 'mixed' ? 'fa-adjust' : 'fa-thumbs-up';
  const fmt = (n) => Number(n).toLocaleString('zh-CN'); // 千分位，XDGame formatNumber 同款

  // 「数据更新于 YYYY-MM-DD」（本地时区）；无时间戳则省略该行（XDGame 为 hidden）
  let updatedHtml = '';
  const d = cachedAt ? new Date(cachedAt) : null;
  if (d && !isNaN(d.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    updatedHtml = `<small data-steam-updated>数据更新于 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}</small>`;
  }

  return `
    <section class="steam-review-card" data-steam-appid="${common.escapeAttr(String(data.appId || ''))}" aria-label="Steam 玩家评价">
      <div class="steam-review-overview">
        <div class="steam-review-heading">
          <span class="steam-review-icon fa fa-steam" aria-hidden="true"></span>
          <span><strong>Steam 玩家评价</strong><small>玩家评价统计</small></span>
        </div>
        <span class="steam-review-level is-${sentiment}" data-steam-level-wrap><i class="fa ${levelIcon}" data-steam-level-icon aria-hidden="true"></i><strong data-steam-rating-text>${esc(ratingText)}</strong></span>
      </div>
      <div class="steam-review-detail">
        <div class="steam-review-primary">
          <span class="steam-review-final-score"><strong data-steam-score>${score}</strong><span><b>/10</b><small>综合评分</small></span></span>
          <p class="steam-review-rate"><span>Steam 好评率 <b data-steam-raw>${rawPercent.toFixed(1)}%</b></span><span>· <b data-steam-total>${fmt(total)}</b> 条评价</span></p>
          ${updatedHtml}
        </div>
        <div class="steam-review-judgment">
          <p class="steam-review-verdict" data-steam-verdict>${esc(verdict)}</p>
          <div class="steam-review-meter" role="meter" aria-label="综合口碑" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${adjusted.toFixed(1)}" aria-valuetext="综合口碑 ${adjusted.toFixed(1)}%"><span data-steam-positive-bar style="width:${adjusted.toFixed(1)}%"></span></div>
          <p class="steam-review-meta"><span>好评 <b class="is-positive" data-steam-positive>${fmt(positive)}</b></span><span>差评 <b class="is-negative" data-steam-negative>${fmt(Math.max(total - positive, 0))}</b></span><span>修正口碑 <b data-steam-adjusted>${adjusted.toFixed(1)}%</b></span></p>
          <div id="gr-steam250-inline" style="display:none;margin-top:6px;font-size:12px;color:#7c8999;line-height:20px;"></div>
        </div>
      </div>
    </section>`;
}
