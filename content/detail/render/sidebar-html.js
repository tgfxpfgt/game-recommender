/**
 * 游戏雷达 Game Radar - Steam 信息栏模板 / Steam Info Sidebar HTML
 *
 * v5.1.0：由 detail-page.js 拆分——纯 HTML 模板函数（无 DOM 绑定）。
 * v14.5.0 B6：由 detail-templates.js 拆至 render/——评分区块独立为
 * render/rating-rows.js，本文件保留 steamSidebar 主体（头部/标题/可排序
 * 模块/中文评测/底部信息栏）。按钮绑定由逻辑层按元素 id 约定完成。
 * steamSidebar body (B6): rating rows live in render/rating-rows.js; this
 * file keeps the main template. Button binding stays in the logic layer.
 */
import * as common from '../../core/common.js';
import { heatLabelFor } from '../../core/steam-rating-logic.js';
import { FM_KEYS, FM_DEFAULT_ORDER } from '../../../shared/fm-keys.js'; // v14.2.0：键序单源
import { renderRatingRows, renderVerdictRow } from './rating-rows.js';
import { renderMatchConfidenceRow } from './match-confidence-row.js'; // v14.28.7 R4-B3

const esc = (text) => common.escapeHtml(text);

// Steam 信息栏完整模板（数据 + 缓存时间 → HTML）
// v14.24.0（用户需求：手动更新/重新检索/选择机型迁入右上角 ⚙ 菜单）：底部
// 两按钮移除——动作由浮窗菜单承担（data-menu-action，见 floats.js/sidebar.js）。
// Full Steam-info sidebar template (data + cachedAt → HTML); the bottom action
// buttons moved into the float ⚙ menu since v14.24.0.
export function steamSidebar(data, cachedAt) {
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
  // v14.2.0：键序改读 shared/fm-keys.js 单源（此前为本地字面量副本——5 份副本之一）
  const order = Array.isArray(mods.order) && mods.order.length > 0 ? mods.order.filter((k) => FM_KEYS.includes(k)) : [];
  for (const k of FM_DEFAULT_ORDER) if (!order.includes(k)) order.push(k); // 补缺失项（保底）
  // 评级色（v5.0.0：颜色单源 __GR_PATTERNS__；v10.7.0 删字面量 fallback）
  const P = globalThis.__GR_PATTERNS__;
  const rate = Number(data.positiveRate) || 0; // v10.9：非数值防 NaN 进进度条
  // v9.6.0：评分区改 Steam 风格——颜色在 row 内经 colorOf 单源计算（此处不再需要）
  const ratingBg = P.ratingBgFor(rate);

  const cacheAgeText = common.formatRelativeTime(cachedAt);

  // v14.19.0：手动主机映射条目的 MC 视图（用户需求：详情页匹配错误时手动
  // 选择机型 → Metacritic 评分）——标题 + MC 徽章（色带同列表页惯例）+
  // 平台标签 + Metacritic 页面链接。数据经 normalize（reviews 等）不影响。
  if (data.platformOnly || data.mcScore != null) {
    const mcScore = typeof data.mcScore === 'number' ? data.mcScore : null;
    const mcColor = mcScore != null ? (mcScore >= 75 ? '#66cc33' : mcScore >= 50 ? '#ffcc33' : '#ff4444') : '';
    const mcSlug = common.escapeAttr(
      data.mcName ? 'https://www.metacritic.com/game/' + encodeURIComponent(data.mcName) + '/' : ''
    );
    return `
      <div class="gr-detail-content">
        <div class="gr-detail-title">${esc(data.name)}</div>
        <div style="display:flex;align-items:center;gap:8px;margin:10px 0;flex-wrap:wrap;">
          <span style="display:inline-block;padding:3px 10px;font-size:13px;font-weight:bold;color:#fff;background:${mcColor || '#555'};border-radius:3px;">${mcScore != null ? `MC ${mcScore}` : 'MC —'}</span>
          <span style="padding:3px 10px;font-size:12px;background:rgba(143,152,160,0.15);color:#c7d5e0;border:1px dashed #555;border-radius:3px;">🎮 ${esc(data.platformTag || '主机')}</span>
        </div>
        <div style="font-size:12px;color:#8f98a0;line-height:1.7;margin-bottom:12px;">
          ${mcScore != null ? `Metacritic 媒体评分（${esc(String(data.mcName || ''))}）——已按你的声明记录为主机游戏，评分长期生效。` : '已按你的声明记录为' + esc(data.platformTag || '主机') + '游戏（Metacritic 暂无该条评分，后续访问自动补查）。'}
        </div>
        ${mcSlug ? `<a href="${mcSlug}" target="_blank" rel="noopener" style="font-size:12px;color:#67c1f5;text-decoration:none;">在 Metacritic 查看评价 ↗</a>` : ''}
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid #2a475e;font-size:11px;color:#8f98a0;">
          <span>缓存于 ${cacheAgeText}</span>
        </div>
      </div>
    `;
  }

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
          ${spy.positiveRate !== null && spy.positiveRate !== undefined ? `<div class="gr-detail-dim">好评率: <span class="gr-detail-blue">${esc(String(spy.positiveRate))}%</span>${spy.reviewCount ? ` · ${esc(spy.reviewCount)} 条` : ''}</div>` : ''}
          ${spy.currentPlayers ? `<div class="gr-detail-dim">当前在线: <span class="gr-detail-green">${esc(spy.currentPlayers)}</span> 人</div>` : ''}
          ${spy.owners ? `<div class="gr-detail-dim">拥有者: <span class="gr-detail-strong">${esc(spy.owners)}</span>${spyHeatLabel() ? ` · 热度 <span class="gr-detail-green">${spyHeatLabel()}</span>` : ''}</div>` : ''}
          ${spy.averagePlaytime ? `<div class="gr-detail-dim">平均时长: <span class="gr-detail-strong">${esc(spy.averagePlaytime)}</span></div>` : ''}
        </div>
      `;
  } else {
    spyBody = `<div class="gr-detail-muted">SteamSpy 数据暂不可用（站点可能启用了人机验证）</div>`;
  }
  spyHtml =
    mods.spy === false
      ? ''
      : `
      <div class="gr-detail-spy">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:12px;font-weight:bold;color:#fff;">📊 SteamSpy</span>
          ${data.steamdbUrl ? `<a href="${common.escapeAttr(data.steamdbUrl)}" target="_blank" style="font-size:11px;color:#67c1f5;text-decoration:none;">SteamDB 查看 ↗</a>` : ''}
          ${data.downloadSiteSearchUrl ? `<a href="${common.escapeAttr(data.downloadSiteSearchUrl)}" target="_blank" rel="noopener" style="font-size:11px;color:#67c1f5;text-decoration:none;">在下载站搜索 ↗</a>` : ''}
        </div>
        ${spyBody}
      </div>
    `;

  // v14.22.2：异步数据行锚点从 spy 块提出为常驻独立块（用户报告"浮窗缺
  // Steam250 排名信息"根因）——Steam250 排名/系列作品/ITAD 最低价/收藏按钮
  // 的数据源是各自独立的后台消息，与 SteamSpy 无关；原嵌在 spy 块内导致
  // options 关闭 SteamSpy 模块（fmSpy）时四行一并消失。行默认 display:none、
  // 数据就绪才填充显示，常驻渲染零视觉成本。
  // v14.22.2: async row anchors hoisted out of the spy block — Steam250/
  // series/ITAD/favorite rows no longer vanish when the SteamSpy module is
  // toggled off (independent data sources; rows self-hide until filled).
  const asyncRowsHtml = `
      <div id="gr-steam250-row" style="display:none;margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;color:#8f98a0;line-height:1.6;"></div>
      <div id="gr-series-row" style="display:none;margin-top:6px;font-size:11px;color:#8f98a0;line-height:1.8;"></div>
      <div id="gr-itad-row" style="display:none;margin-top:6px;font-size:11px;color:#8f98a0;line-height:1.6;"></div>
      <div id="gr-fav-row" style="display:none;margin-top:6px;font-size:11px;"></div>
    `;

  // ============ 五个可排序信息模块（v14.1.0：order 真正接管排布） ============
  // 此前 order 只计算未使用，块按源码固定序渲染。现各块构建为字符串后按
  // order 数组装配（mods.xxx === false 的块输出空串；缺失项已在上方补默认序）。
  // The five sortable info modules are built as strings and joined in the
  // user's configured order; hidden modules render as empty strings.

  // ① 中文支持 + 发行信息芯片 / chips
  const chipsHtml =
    mods.chips === false
      ? ''
      : `
        <div class="gr-detail-tags">
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
        </div>`;

  // ② 热门用户标签 + 官方类型（genres 非独立模块，始终跟随 tags 块）
  const tagsHtml = `
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
        }`;

  // ③ 开发商 / developers
  const developersHtml =
    mods.developers !== false && data.developers && data.developers.length > 0
      ? `
          <div style="font-size:12px;color:#8f98a0;margin-bottom:10px;">开发商: <span style="color:#67c1f5;">${esc(data.developers.join(', '))}</span></div>
        `
      : '';

  // ④ 简介 / description
  const descriptionHtml =
    mods.description !== false && data.description
      ? `
          <div style="font-size:12px;color:#acb2b8;margin-bottom:12px;line-height:1.6;max-height:80px;overflow:hidden;">
            ${esc(data.description.substring(0, 200))}${data.description.length > 200 ? '...' : ''}
          </div>
        `
      : '';

  // ⑤ SteamSpy（spyHtml 上方已按 mods.spy 构建）/ spy
  const orderedModulesHtml = order
    .map(
      (k) =>
        ({ chips: chipsHtml, tags: tagsHtml, developers: developersHtml, description: descriptionHtml, spy: spyHtml })[
          k
        ] || ''
    )
    .join('');

  // v14.5.0 B6：评分区块（四重评价行 + 综合推荐行）由 render/rating-rows.js 提供
  const ratingRowsHtml = renderRatingRows(data, spy);
  const verdictRowHtml = renderVerdictRow(data, spy, spyHeatLabel);
  // v14.28.7 R4-B3：匹配置信度行（推测态 → 徽章 + 依据；无字段 → 空串）
  const confidenceHtml = renderMatchConfidenceRow(data);

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

        <!-- 匹配置信度（v14.28.7 R4-B3：推测态徽章 + 依据，紧贴标题） -->
        ${confidenceHtml}

        <!-- 跳转Steam按钮 -->
        ${
          data.url
            ? `<a href="${common.escapeAttr(data.url)}" target="_blank" class="gr-detail-btn">在 Steam 上查看</a>`
            : ''
        }

        <!-- 评分区域 - 四重评价（Steam总体/最近30天/简体中文/SteamSpy） -->
                        <div class="gr-detail-rating-box" style="background:${ratingBg};">
          ${ratingRowsHtml}
<!-- v4.1.0：综合推荐理由（好评率 70% + 中文 30% 口径 + 热度/时长因子，与推荐引擎同源） -->
          ${verdictRowHtml}
        </div>

        <!-- 可排序信息模块（chips/tags/developers/description/spy 按用户配置序） -->
        ${orderedModulesHtml}

        <!-- 异步数据行（Steam250/系列/ITAD/收藏，独立于 spy 模块常驻锚点 v14.22.2） -->
        ${asyncRowsHtml}

        <!-- 中文评测 -->
        ${reviewsHtml}

        <!-- 底部信息栏：App ID + 缓存时间（动作在右上角 ⚙ 菜单，v14.24.0 迁移） -->
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid #2a475e;font-size:11px;color:#8f98a0;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            ${data.appId ? `<span>App ID: <a href="${common.escapeAttr('https://store.steampowered.com/app/' + data.appId)}" target="_blank" style="color:#67c1f5;text-decoration:none;">${esc(String(data.appId))}</a></span>` : '<span>App ID: —</span>'}
            <span title="${cachedAt ? new Date(cachedAt).toLocaleString() : ''}">缓存于 ${cacheAgeText}</span>
          </div>
        </div>
      </div>
    `;
}
