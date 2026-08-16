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

const esc = (text) => common.escapeHtml(text);

// Steam 信息栏完整模板（数据 + 缓存时间 + 按钮开关 → HTML）
// Full Steam-info sidebar template (data + cachedAt + button flags → HTML)
export function steamSidebar(data, cachedAt, hasRefresh, hasReport) {
  // 评级色（v5.0.0：颜色单源 __GR_PATTERNS__）
  const P = globalThis.__GR_PATTERNS__ || {};
  const rate = data.positiveRate || 0;
  // v9.6.0：评分区改 Steam 风格——颜色在 row 内经 colorOf 单源计算（此处不再需要）
  const ratingBg = P.ratingBgFor
    ? P.ratingBgFor(rate)
    : rate >= 80
      ? 'rgba(102,192,244,0.15)'
      : rate >= 60
        ? 'rgba(163,207,6,0.15)'
        : 'rgba(255,123,0,0.15)';

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
  const spyHeatLabel = () => {
    if (!spy || typeof spy.ownersLow !== 'number' || typeof spy.ownersHigh !== 'number' || spy.ownersHigh <= 0)
      return '';
    const mid = (spy.ownersLow + spy.ownersHigh) / 2;
    const h = Math.min(Math.log10(mid) / 7, 1);
    return h >= 0.85 ? '爆款' : h >= 0.6 ? '热门' : h >= 0.35 ? '一般' : '冷门';
  };
  let spyBody = '';
  if (hasSpyData) {
    spyBody = `
        <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;">
          ${spy.positiveRate !== null && spy.positiveRate !== undefined ? `<div class="gr-detail-dim">好评率: <span class="gr-detail-blue">${spy.positiveRate}%</span>${spy.reviewCount ? ` · ${spy.reviewCount} 条` : ''}</div>` : ''}
          ${spy.currentPlayers ? `<div class="gr-detail-dim">当前在线: <span class="gr-detail-green">${spy.currentPlayers}</span> 人</div>` : ''}
          ${spy.owners ? `<div class="gr-detail-dim">拥有者: <span class="gr-detail-strong">${spy.owners}</span>${spyHeatLabel() ? ` · 热度 <span class="gr-detail-green">${spyHeatLabel()}</span>` : ''}</div>` : ''}
          ${spy.averagePlaytime ? `<div class="gr-detail-dim">平均时长: <span class="gr-detail-strong">${spy.averagePlaytime}</span></div>` : ''}
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
        <div class="gr-detail-tags">
          <span style="padding:2px 8px;border-radius:2px;background:${data.chineseSupported ? 'rgba(163,207,6,0.15)' : 'rgba(255,255,255,0.05)'};color:${data.chineseSupported ? '#a3cf06' : '#666'};">
            ${data.chineseSupported ? (data.simplifiedChinese ? '✓ 简体中文' : '✓ 支持中文') : '✗ 暂不支持中文'}
            ${data.chineseSupported && data.chineseHasAudio ? ' · 音频' : ''}
            ${data.chineseSupported && data.chineseHasSubtitles ? ' · 字幕' : ''}
          </span>
          ${data.releaseDate ? `<span class="gr-detail-chip">📅 ${esc(data.releaseDate)}</span>` : ''}
          ${data.lastUpdate ? `<span class="gr-detail-chip">🛠 更新 ${esc(data.lastUpdate)}</span>` : ''}
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
              desc +
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
          data.userTags && data.userTags.length > 0
            ? `
          <div style="margin-bottom:12px;">
            <div style="font-size:12px;color:#8f98a0;margin-bottom:5px;">🔥 热门用户标签</div>
            <div class="gr-detail-flex-wrap">
              ${data.userTags.map((t) => `<span style="padding:3px 8px;font-size:11px;background:rgba(103,193,245,0.12);color:#67c1f5;border-radius:2px;cursor:default;">${esc(t)}</span>`).join('')}
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
          data.developers && data.developers.length > 0
            ? `
          <div style="font-size:12px;color:#8f98a0;margin-bottom:10px;">开发商: <span style="color:#67c1f5;">${esc(data.developers.join(', '))}</span></div>
        `
            : ''
        }

        <!-- 简介 -->
        ${
          data.description
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
            ${data.appId ? `<span>App ID: <a href="https://store.steampowered.com/app/${data.appId}" target="_blank" style="color:#67c1f5;text-decoration:none;">${data.appId}</a></span>` : '<span>App ID: —</span>'}
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
