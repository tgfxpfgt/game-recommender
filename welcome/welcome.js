/**
 * 游戏雷达 Game Radar - 欢迎页 / Welcome Page
 *
 * v7.4.0：安装（source=install）显示功能导览；更新（source=update）显示
 * What's new。由 SW runtime.onInstalled 打开；也可手动访问
 * welcome/welcome.html?source=install|update。
 */
'use strict';

(function () {
  const manifest = (chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest()) || {};
  const ver = manifest.version || '';
  const verEl = document.getElementById('extVersion');
  if (verEl && ver) verEl.textContent = 'v' + ver;

  const source = new URLSearchParams(location.search).get('source') || 'install';
  const isUpdate = source === 'update';
  document.getElementById('installSection').classList.toggle('hidden', isUpdate);
  document.getElementById('updateSection').classList.toggle('hidden', !isUpdate);
  document.getElementById('welcomeSubtitle').textContent = isUpdate
    ? '已更新到新版本，看看有什么新变化'
    : '下载站好游戏，一眼看穿';

  document.getElementById('openHubBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'OPEN_HUB' }).catch(() => {});
    window.close();
  });
  document.getElementById('closeBtn').addEventListener('click', () => window.close());
})();
