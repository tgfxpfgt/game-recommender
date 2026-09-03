/**
 * 游戏雷达 Game Radar - 设置中心逻辑 / Hub Logic
 * v6.4.11：扩展全部页面的集中入口。侧栏切换 iframe 页面；
 * hash 直达；子页面（?hub=1）发 GR_HUB_SWITCH 消息切面板。
 */
'use strict';

const PAGES = {
  options: { label: '设置（经典）', url: '../options/options.html?hub=1' },
  dashboard: { label: '数据分析', url: '../dashboard/dashboard.html?hub=1' },
  freegames: { label: '限免游戏', url: '../freegames/freegames.html?hub=1' }
};

const frame = document.getElementById('hubFrame');

// v8.1.0：应用皮肤主题（与各页面一致）
(async () => {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    if (resp && resp.settings && window.__GR_SETTINGS_UTILS__) {
      window.__GR_SETTINGS_UTILS__.applyTheme(resp.settings.uiTheme || 'steam');
    }
  } catch {
    /* 后台不可达时保持默认主题 */
  }
})();

// 当前页面（hash 或默认 options）
function currentPage() {
  const m = String(location.hash).match(/page=([a-z]+)/);
  return m && PAGES[m[1]] ? m[1] : 'options';
}

function switchPage(page) {
  if (!PAGES[page]) page = 'options';
  // 更新导航高亮
  document.querySelectorAll('.hub-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.page === page);
  });
  // 更新 hash（不触发重新加载）
  const nextHash = `#page=${page}`;
  if (location.hash !== nextHash) {
    history.replaceState(null, '', nextHash);
  }
  // 加载目标页面（重复切换同一页面时重新加载，保证最新状态）
  const url = chrome.runtime.getURL(PAGES[page].url);
  frame.src = url;
}

// 侧栏点击切换
document.querySelectorAll('.hub-item').forEach((btn) => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

// 子页面请求切换（goHub 在 iframe 内发 postMessage）
window.addEventListener('message', (e) => {
  // v10.5.0 P3：仅接受同源（扩展 origin）消息——hub 与子 iframe 同为 chrome-extension 源
  if (e.origin !== location.origin) return;
  if (e.data && e.data.type === 'GR_HUB_SWITCH' && PAGES[e.data.page]) {
    switchPage(e.data.page);
  }
});

// 新标签打开当前页面
document.getElementById('openInTab').addEventListener('click', () => {
  const page = currentPage();
  chrome.tabs.create({ url: chrome.runtime.getURL(PAGES[page].url.replace('?hub=1', '')) });
});

// 版本号
document.getElementById('hubVersion').textContent = 'v' + chrome.runtime.getManifest().version;

// 初始化
switchPage(currentPage());
