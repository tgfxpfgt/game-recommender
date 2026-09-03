/**
 * 游戏雷达 Game Radar - 下载追踪模块 / Download Tracking Module
 *
 * 始终激活：全局点击委托（capture 阶段）+ 复制事件捕获。
 * v10.0.0：移除 window.open 拦截——内容脚本运行在隔离世界，覆盖 window.open
 * 只对扩展自身的全局生效，站点页面 JS 的调用完全不受影响（死代码）；
 * 网盘链接的 window.open 路径由点击委托覆盖（target 含 data-href/onclick 等）。
 * Always active: global click delegation (capture phase) and copy capture.
 * window.open interception removed (v10.0.0): the content script lives in an
 * isolated world, so overriding window.open cannot see page JS calls.
 */
import * as debug from '../core/debug.js';
import * as common from '../core/common.js';
import * as detail from '../detail/detail-page.js';

// 网盘/下载URL识别（覆盖主流网盘）/ Pan/download URL detection
export function isDownloadUrl(str) {
  if (!str) return false;
  return /pan\.baidu\.com|yun\.baidu\.com|baidupcs|aliyundrive\.com|alipan\.com|115\.com|quark\.cn|weiyun\.com|jianwen\.com|caiyun\.com|139\.com|mega\.nz|mediafire|1fichier|gofile|rapidgator|uploaded\.net|magnet:|thunder:|ed2k:|ftp:|\.torrent/i.test(
    str
  );
}

// 下载相关文本识别 / Download-related text detection
export function isDownloadText(text) {
  if (!text) return false;
  return /百度网盘|百度云|网盘|百度盘|阿里云盘|夸克网盘|115网盘|微云|提取码|下载游戏|游戏下载|高速下载|普通下载|磁力|种子/.test(
    text
  );
}

// 记录一次下载事件 / Record a download event
function recordDownload(url, text, method) {
  debug.DEBUG.downloadEvents++;
  debug.dbg(`📥 下载事件 [${method}]: ${text}`);
  // v10.1.0：详情页解析出的 AppID 经 DOM 数据桥接随事件上报（后台累计跨站点
  // 下载计数 a）；列表页等无 appId 场景不带上（后台不计数）
  let appId;
  try {
    appId = document.documentElement.dataset.grAppId || undefined;
  } catch {
    appId = undefined;
  }
  common.trackEvent('click_download', {
    gameName: debug.DEBUG.gameName || detail.detectGameName() || document.title,
    keywords: [],
    appId,
    downloadUrl: url,
    downloadText: text,
    method: method
  });
  debug.scheduleDebugUpdate();
}

// 设置下载追踪（打开网盘即视为下载）
// 策略：全局点击委托（capture 阶段）+ copy 事件捕获（v10.0.0 起不再拦截
// window.open——隔离世界覆盖对站点自身 JS 无效，见文件头说明）。
export function setupDownloadTracking(settings = {}) {
  // v10.5.0 P3：尊重独立开关——此前 tracker 传了 settings 但本函数忽略，导致
  // downloadTrackingEnabled=false 仍全程追踪（死开关）。默认开启（true/未定义）。
  if (settings && settings.downloadTrackingEnabled === false) {
    debug.dbg('下载追踪已关闭（跳过点击/复制捕获）');
    return;
  }
  debug.dbg('设置下载追踪...');

  // 1. 全局点击委托（capture 阶段，覆盖静态与动态链接）
  document.addEventListener(
    'click',
    (e) => {
      // 防护：点击空白处等非 Element 目标时 closest 会抛错
      const target =
        e.target instanceof Element
          ? e.target.closest(
              'a, button, [onclick], [data-href], [class*="down"], [class*="baidu"], [class*="pan"], [id*="down"], [class*="netdisk"]'
            )
          : null;
      if (!target) return;

      const text = (target.textContent || '').trim();
      const urls = [
        target.href,
        target.getAttribute('data-href'),
        target.getAttribute('data-url'),
        target.getAttribute('data-link'),
        target.getAttribute('onclick')
      ].filter(Boolean);

      const hasDownloadUrl = urls.some((u) => isDownloadUrl(u));
      const hasDownloadText = isDownloadText(text);

      if (hasDownloadUrl || hasDownloadText) {
        const url = urls.find((u) => isDownloadUrl(u)) || urls[0] || text;
        recordDownload(url, text.substring(0, 50) || '网盘下载', 'delegate_click');
      }
    },
    true
  );

  // 3. 复制事件 - 捕获网盘链接/提取码复制
  document.addEventListener('copy', () => {
    const sel = window.getSelection()?.toString() || '';
    if (isDownloadUrl(sel) || /提取码|密码|网盘|pan\.baidu/.test(sel)) {
      recordDownload(sel.substring(0, 200), '复制网盘链接/提取码', 'copy_link');
    }
  });

  debug.dbg('✅ 下载追踪已激活');
}
