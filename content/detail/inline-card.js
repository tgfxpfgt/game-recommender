/**
 * 游戏雷达 Game Radar - 内嵌 Steam 信息卡 / Inline Steam Info Card
 *
 * v14.3.0（第五轮 B1）：由 sidebar.js 拆分——咸鱼单机/gamer520 详情页标题下方
 * 注入的 XDGame 同款「Steam 玩家评价」信息卡（模板 detailTemplates.steamInline
 * Section，样式为 XDGame article_steam_rating_20260905.css 1:1 译本，站点按
 * features.inlineSteamCard 门控）。纯展示随页面排版，与交互浮窗互补。
 * The pixel-faithful inline review card for hosts without XDGame's native one.
 */
import * as detailTemplates from './detail-templates.js';
import * as builder from '../adapters/builder.js';
import * as debug from '../core/debug.js';

const dbg = (...a) => debug.dbg(...a);

// ============ v10.5.3 任务1：内嵌 Steam 信息区（咸鱼单机/gamer520） ============
// XDGame 站点原生详情页自带「Steam 玩家评价」信息区，咸鱼单机/gamer520 没有。
// 在这两站详情页标题下方注入与 XDGame 完全一致的信息卡（模板见
// detailTemplates.steamInlineSection，样式为 XDGame article_steam_rating_
// 20260905.css 的 1:1 译本，见下方 INLINE_SECTION_CSS）。与浮窗互补：信息卡
// 纯展示随页面排版，浮窗保留交互（刷新缓存/人工纠错/手动选择）。站点按适配
// 器 key 门控，避免与 XDGame 原生信息区重复。
// Inline Steam review card for xianyudanji/gamer520 (XDGame has a native
// one): a pixel-faithful replica — template in detailTemplates, stylesheet
// below translated 1:1 from XDGame's own CSS. Display-only companion to the
// interactive float, gated by adapter key.
const INLINE_SECTION_ID = 'gr-steam-inline-section';
const INLINE_SECTION_STYLE_ID = 'gr-steam-inline-style';

// XDGame article_steam_rating_20260905.css 1:1 译本：
//  · `.soft-detail .steam-review-*` → `#gr-steam-inline-section .steam-review-*`
//    （作用域挂到注入容器 id，不泄漏到宿主页、不影响 XDGame 原生卡片）
//  · `body.night .soft-detail *` → `#gr-steam-inline-section.gr-night *`
//    （XDGame 夜间为整站 body.night；宿主页以背景亮度判定后加 .gr-night 类）
//  · 字体/盒模型基线取自 XDGame 页面（layui body：14px Helvetica Neue 栈）
// 1:1 translation of XDGame's card CSS, scoped under the injected wrapper.
const INLINE_SECTION_CSS = `
#gr-steam-inline-section{font-family:'Helvetica Neue',Helvetica,'PingFang SC',Tahoma,Arial,sans-serif;font-size:14px;line-height:24px}
#gr-steam-inline-section,#gr-steam-inline-section *{box-sizing:border-box}
#gr-steam-inline-section p{margin:0}
#gr-steam-inline-section .steam-review-card{display:grid;grid-template-columns:230px minmax(0,1fr);gap:22px;box-sizing:border-box;margin:16px 0 20px;padding:17px 18px;border:1px solid #dce6f1;border-radius:14px;background:linear-gradient(145deg,#fbfdff 0%,#f5f8fc 100%);box-shadow:0 14px 30px -27px rgba(29,56,96,.5);color:#354052}
#gr-steam-inline-section .steam-review-overview{display:flex;flex-direction:column;justify-content:center;min-width:0;padding-right:20px;border-right:1px solid #e3e9f1}
#gr-steam-inline-section .steam-review-heading{display:flex;align-items:center;min-width:0}
#gr-steam-inline-section .steam-review-icon{display:inline-flex;flex:0 0 40px;align-items:center;justify-content:center;width:40px;height:40px;margin-right:11px;border:1px solid #d5e1ee;border-radius:11px;background:#eaf2fa;color:#4f779f;font-size:21px}
#gr-steam-inline-section .steam-review-heading strong{display:block;color:#2d394a;font-size:16px;font-weight:700;line-height:22px;white-space:nowrap}
#gr-steam-inline-section .steam-review-heading small{display:block;color:#8a96a5;font-size:13px;line-height:20px}
#gr-steam-inline-section .steam-review-level{display:inline-flex;align-items:center;align-self:flex-start;gap:6px;min-height:27px;margin:10px 0 0 51px;padding:0 10px;border-radius:999px;font-size:14px;font-weight:700;line-height:27px}
#gr-steam-inline-section .steam-review-level.is-positive{background:#e3f4ec;color:#2e8660}
#gr-steam-inline-section .steam-review-level.is-mixed{background:#fff1d8;color:#a26c17}
#gr-steam-inline-section .steam-review-level.is-negative{background:#f9e7e9;color:#bd545d}
#gr-steam-inline-section .steam-review-detail{display:grid;grid-template-columns:minmax(225px,.9fr) minmax(260px,1.2fr);gap:18px;min-width:0}
#gr-steam-inline-section .steam-review-primary{display:flex;flex-direction:column;justify-content:center;min-width:0;padding-right:18px;border-right:1px solid #e3e9f1}
#gr-steam-inline-section .steam-review-judgment{display:flex;flex-direction:column;justify-content:center;min-width:0}
#gr-steam-inline-section .steam-review-final-score{display:flex;align-items:baseline;gap:7px;min-width:0;white-space:nowrap}
#gr-steam-inline-section .steam-review-final-score>strong{color:#356da8;font-size:31px;font-weight:800;line-height:34px;letter-spacing:-.04em}
#gr-steam-inline-section .steam-review-final-score>span{display:flex;align-items:baseline;gap:8px;color:#536174}
#gr-steam-inline-section .steam-review-final-score b{color:#788595;font-size:13px;font-weight:600}
#gr-steam-inline-section .steam-review-final-score small{font-size:15px;font-weight:700}
#gr-steam-inline-section .steam-review-rate{display:flex;align-items:baseline;gap:8px;margin:1px 0 0;min-width:0;color:#748192;font-size:14px;line-height:21px;white-space:nowrap}
#gr-steam-inline-section .steam-review-rate b{color:#536174;font-size:14px;font-weight:700}
#gr-steam-inline-section .steam-review-primary>small{margin-top:3px;color:#98a3b0;font-size:12px;line-height:19px;white-space:nowrap}
#gr-steam-inline-section .steam-review-verdict{margin:0 0 10px;color:#3d4a5c;font-size:15px;font-weight:700;line-height:22px}
#gr-steam-inline-section .steam-review-meter{position:relative;height:8px;overflow:hidden;border-radius:999px;background:#e9cfd2}
#gr-steam-inline-section .steam-review-meter span{display:block;width:0;height:100%;border-radius:999px;background:linear-gradient(90deg,#55b58b,#72c99f);transition:width .5s ease}
#gr-steam-inline-section .steam-review-meta{display:flex;flex-wrap:wrap;gap:4px 16px;margin:8px 0 0;color:#7c8999;font-size:13px;line-height:20px}
#gr-steam-inline-section .steam-review-meta b{color:#5c697a;font-size:14px;font-weight:700}
#gr-steam-inline-section .steam-review-meta b.is-positive{color:#2f8a63}
#gr-steam-inline-section .steam-review-meta b.is-negative{color:#c66068}
#gr-steam-inline-section.gr-night .steam-review-card{border-color:#3b4655;background:linear-gradient(145deg,#292d33 0%,#262a30 100%);box-shadow:none;color:#cbd3de}
#gr-steam-inline-section.gr-night .steam-review-overview{border-color:#3e4855}
#gr-steam-inline-section.gr-night .steam-review-icon{border-color:#44566b;background:#303d4c;color:#91b6da}
#gr-steam-inline-section.gr-night .steam-review-heading strong{color:#e0e6ee}
#gr-steam-inline-section.gr-night .steam-review-heading small,#gr-steam-inline-section.gr-night .steam-review-primary>small,#gr-steam-inline-section.gr-night .steam-review-meta{color:#939fad}
#gr-steam-inline-section.gr-night .steam-review-level.is-positive{background:#30473f;color:#83c9aa}
#gr-steam-inline-section.gr-night .steam-review-level.is-mixed{background:#50452e;color:#e5bd72}
#gr-steam-inline-section.gr-night .steam-review-level.is-negative{background:#50363a;color:#e18b92}
#gr-steam-inline-section.gr-night .steam-review-primary{border-color:#3e4855}
#gr-steam-inline-section.gr-night .steam-review-final-score>strong{color:#92bce7}
#gr-steam-inline-section.gr-night .steam-review-final-score>span,#gr-steam-inline-section.gr-night .steam-review-final-score b{color:#aeb9c6}
#gr-steam-inline-section.gr-night .steam-review-rate{color:#aeb8c4}
#gr-steam-inline-section.gr-night .steam-review-rate b,#gr-steam-inline-section.gr-night .steam-review-meta b{color:#c8d0da}
#gr-steam-inline-section.gr-night .steam-review-verdict{color:#d3dae4}
#gr-steam-inline-section.gr-night .steam-review-meter{background:#563b40}
#gr-steam-inline-section.gr-night .steam-review-meta b.is-positive{color:#75c9a3}
#gr-steam-inline-section.gr-night .steam-review-meta b.is-negative{color:#e18b92}
@media screen and (max-width:640px){
#gr-steam-inline-section .steam-review-card{grid-template-columns:1fr;gap:13px;margin:14px 0 18px;padding:15px;border-radius:12px}
#gr-steam-inline-section .steam-review-overview{flex-direction:row;align-items:center;justify-content:space-between;gap:10px;padding:0 0 13px;border-right:0;border-bottom:1px solid #e3e9f1}
#gr-steam-inline-section .steam-review-icon{width:38px;height:38px;flex-basis:38px;margin-right:9px;font-size:20px}
#gr-steam-inline-section .steam-review-heading strong{font-size:16px}
#gr-steam-inline-section .steam-review-heading small{font-size:13px}
#gr-steam-inline-section .steam-review-level{flex:0 0 auto;align-self:auto;min-height:27px;margin:0;padding:0 9px;font-size:13px}
#gr-steam-inline-section .steam-review-detail{grid-template-columns:1fr;gap:10px}
#gr-steam-inline-section .steam-review-primary{position:relative;padding:0;border-right:0}
#gr-steam-inline-section .steam-review-final-score>strong{font-size:34px;line-height:37px}
#gr-steam-inline-section .steam-review-final-score>span{display:flex;align-items:baseline;gap:7px}
#gr-steam-inline-section .steam-review-final-score b,#gr-steam-inline-section .steam-review-final-score small{display:inline;line-height:20px}
#gr-steam-inline-section .steam-review-final-score small{font-size:14px}
#gr-steam-inline-section .steam-review-rate{flex-wrap:wrap;gap:1px 7px;margin-top:3px;font-size:14px;white-space:normal}
#gr-steam-inline-section .steam-review-primary>small{position:absolute;top:5px;right:0;margin:0;font-size:11px}
#gr-steam-inline-section .steam-review-verdict{margin:0 0 9px;font-size:15px;line-height:22px}
#gr-steam-inline-section .steam-review-meta{gap:4px 12px;font-size:13px}
#gr-steam-inline-section .steam-review-meta b{font-size:14px}
#gr-steam-inline-section.gr-night .steam-review-overview{border-bottom-color:#3e4855}
}
`;

// 样式随首张卡片注入一次（模块级幂等标记 + DOM id 双保险）
// The stylesheet ships with the first card (idempotent module flag + DOM id).
let inlineStyleInjected = false;
function ensureInlineSectionStyle() {
  if (inlineStyleInjected) return;
  try {
    if (document.getElementById(INLINE_SECTION_STYLE_ID)) {
      inlineStyleInjected = true;
      return;
    }
    const style = document.createElement('style');
    style.id = INLINE_SECTION_STYLE_ID;
    style.textContent = INLINE_SECTION_CSS;
    (document.head || document.documentElement).appendChild(style);
    inlineStyleInjected = true;
  } catch (e) {
    dbg('内嵌信息区样式注入失败: ' + String(e));
  }
}

// 宿主页是否为深色主题（XDGame 夜间配色启用判定）：
// body 计算背景亮度 < 128 → 深色；背景透明不可判定 → 回退系统偏好。
// Dark-host detection for the night palette (XDGame uses body.night).
function hostIsDarkMode() {
  try {
    if (typeof window.getComputedStyle === 'function' && document.body) {
      const bg = window.getComputedStyle(document.body).backgroundColor || '';
      const m = bg.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
      if (m) {
        const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
        if (alpha > 0) {
          const [r, g, b] = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
          return 0.299 * r + 0.587 * g + 0.114 * b < 128;
        }
      }
    }
  } catch {
    /* 计算样式不可用 → 回退系统偏好 / fall back to the media query */
  }
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch {
    return false;
  }
}

/**
 * @param {Object|null} data - Steam 详情缓存（appId/name/totalReviews/...）
 * @param {number} [cachedAt] - 缓存时间戳（ms）
 */
export function renderInlineSteamSection(data, cachedAt) {
  try {
    if (!data) return;
    // 站点门控（v10.7.0 批次4）：由 adapter 规则的 features.inlineSteamCard 声明
    // 决定（内置 xianyudanji/gamer520 打开；自定义站可经规则包启用）——
    // 此前为 INLINE_SECTION_SITES 硬编码数组，规则站无法获得该能力
    let inlineEnabled = false;
    try {
      inlineEnabled = !!((builder.getAdapter() || {}).features || {}).inlineSteamCard;
    } catch {
      /* 适配器不可用时跳过 / skip when the adapter is unavailable */
    }
    if (!inlineEnabled) return;

    const html = detailTemplates.steamInlineSection(data, cachedAt);
    const existing = document.getElementById(INLINE_SECTION_ID);
    if (!html) {
      // 新数据无评测（纠错换游戏等）→ 移除旧卡，与 XDGame 无数据隐藏一致
      if (existing) existing.remove();
      return;
    }

    ensureInlineSectionStyle();

    // 幂等：同游戏已注入 → 跳过；换游戏（纠错重检索）→ 移除旧卡重建
    if (existing) {
      if (existing.getAttribute('data-gr-appid') === String(data.appId || '')) return;
      existing.remove();
    }

    // 插入点：标题（h1 / h2.entry-title，WordPress 主题）之后；无标题时回退
    // 正文容器顶部；两者皆无 → 放弃（极端页面结构，不强行注入）
    const title = document.querySelector('h1, h2.entry-title');
    const content = document.querySelector('.entry-content, .post-content, .article-content, article, main');
    const section = document.createElement('div');
    section.id = INLINE_SECTION_ID;
    section.setAttribute('data-gr-appid', String(data.appId || ''));
    if (hostIsDarkMode()) section.className = 'gr-night'; // 夜间配色（XDGame body.night 等价）
    section.innerHTML = html;
    if (title && title.parentNode) {
      title.parentNode.insertBefore(section, title.nextSibling);
    } else if (content) {
      content.insertBefore(section, content.firstChild);
    } else {
      return;
    }
    dbg('✅ 已注入内嵌 Steam 信息区（详情页标题下方，XDGame 同款）');
  } catch (e) {
    dbg('内嵌 Steam 信息区注入失败: ' + String(e));
  }
}
