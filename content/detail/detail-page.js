/**
 * 游戏雷达 Game Radar - 详情页模块入口 / Detail Page Module Entry
 *
 * 游戏名提取（去徽章/噪声分段）与详情页浮窗入口装配。
 * v14 B3：实现拆分至子模块（入口 API 不变——tracker/download-tracking 的
 * `detail.*` 调用面与 module-manifest 装载均不变）：
 *   sidebar.js     Steam 信息浮窗全生命周期（装载/纠错回调/渲染/按钮绑定/
 *                  Steam250/ITAD/收藏行/内嵌信息卡）
 *   candidates.js  手动选择浮窗（候选列表/搜索/键盘导航）
 *   tracking.js    下载站资源浮窗、下载历史浮窗、TRACK_EVENT 采集
 * Name extraction and the detail-page float entry. Implementations split
 * into sidebar/candidates/tracking since B3; the exported surface is
 * unchanged (tracker keeps calling detail.*).
 */
import * as common from '../core/common.js';
import * as sidebar from './sidebar.js';

// v14 B3：下载站资源浮窗与下载历史浮窗迁至 tracking.js——re-export 保持入口
export { injectDownloadSitePanel, injectDownloadHistoryPanel } from './tracking.js';

// 从 Steam 图片的 alt 属性提取英文游戏名（"XXX on Steam" 模式）
// Extract the EN name from a Steam image alt ("XXX on Steam")
function extractEnglishFromSteamImage() {
  const imgs = document.querySelectorAll('img');
  for (const img of imgs) {
    const alt = (img.getAttribute('alt') || '').trim();
    const match = alt.match(/^(.+?)\s+on\s+Steam$/i);
    if (match) {
      const name = match[1].trim();
      if (name.length > 3 && name.length < 200 && /^[A-Za-z0-9][A-Za-z0-9\s'':&.!\-×x]*$/i.test(name)) {
        return name;
      }
    }
  }
  return null;
}

// 从页面提取游戏名称（不依赖适配器）
// 先移除 h1 徽章元素，再按分隔符分段移除纯噪声段（中英文名段都保留）
// 汇总贴/索引页（顶置汇总、索引）不是单个游戏，直接返回空（跳过详情处理）
export function detectGameName() {
  const h1 = document.querySelector('h1');
  const pageTitle = (document.title || '') + ' ' + (h1 ? h1.textContent : '');
  if (/顶置|置顶|汇总贴|汇总|索引/.test(pageTitle)) return '';

  if (h1) {
    // v10.9.2：在克隆上操作——此前直接 remove() 宿主 h1 内的徽章元素
    //（如咸鱼单机"版本更新"角标会从用户页面永久消失，属宿主页破坏）
    const h1Clone = h1.cloneNode(true);
    h1Clone.querySelectorAll('.post-badge, .badge, [class*="badge"]').forEach((b) => b.remove());

    // 策略1：优先从 h1 子元素中提取纯英文标题
    const enChild = h1Clone.querySelector('span, div, p, em, strong, small');
    if (enChild) {
      const enText = (enChild.textContent || '').trim();
      if (enText.length > 3 && enText.length < 200 && /^[A-Za-z0-9][A-Za-z0-9\s'':&.!\-×x]*$/i.test(enText)) {
        return enText;
      }
    }

    // 策略2：按分隔符分段，移除纯噪声段（保留中英文名段）。
    // 噪声词表来自共享权威源 shared/patterns.js（v3.3.9 单源化，v6.2.0
    // 移除内联降级副本——权威源由 manifest 保证在内容脚本加载时已注入，
    // 与 content-sim 的注入顺序一致）
    const noisePattern = new RegExp(globalThis.__GR_PATTERNS__.noisePatternSource, 'gi');
    let text = h1Clone.textContent.trim();
    const parts = text
      .split(/[|]+|\s+[-–—]\s+|[×•·]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
    const keptParts = parts.filter((p) => {
      const stripped = p.replace(noisePattern, '').replace(/[\s\|\-:：、]+/g, '');
      return stripped.length > 0;
    });
    if (keptParts.length > 0) text = keptParts.join('|');

    text = text.replace(/[\|\-–—:：\s]+$/, '').trim();
    if (text.length > 1 && text.length < 200) {
      // 策略2a：若清理后是纯中文标题，尝试从 Steam 图片 alt 提取英文标题
      if (/[\u4e00-\u9fff]/.test(text) && !/[A-Za-z]{3,}/.test(text)) {
        const enFromImg = extractEnglishFromSteamImage();
        if (enFromImg) return enFromImg;
      }
      return text;
    }

    // 策略3：清理后为空，回退到 textContent 中提取英文子串
    const enMatch = h1Clone.textContent.match(/[A-Za-z][A-Za-z0-9\s'':&.!\-×x]{5,}/);
    if (enMatch && enMatch[0].length > 3 && enMatch[0].length < 200) return enMatch[0].trim();
  }
  // 从 title 获取
  const title = document.title || '';
  if (title) {
    // v5.0.0：清洗链收敛至 common.cleanPageTitle
    const cleaned = common.cleanPageTitle(title);
    return cleaned || document.title;
  }
  return '';
}

// ============ Steam详情浮窗入口 ============
// v14 B3：浮窗装载/渲染/按钮回调整体迁至 sidebar.js（createSteamFloat，
// 闭包状态 steamData/reportIssue 随编排迁移）——入口保留委托，调用面不变。
export function injectSteamButton(gameName, settings) {
  sidebar.createSteamFloat(gameName, settings);
}
