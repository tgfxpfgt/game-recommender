/**
 * 游戏雷达 Game Radar - Vista Aero 菜单逻辑（全新实现，零历史包袱）
 * v6.4.6：全功能（设置/过滤/推荐/限免/缓存/数据/日志/统计）+ 经典菜单切换。
 * All logic lives here: settings render/save (reload-merge pattern), free
 * games, cache management, data management, stats.
 */
'use strict';

const $ = (id) => document.getElementById(id);
let settings = null;

// ============ 保存（保存前重读最新设置，防快照覆盖） ============
async function loadSettings() {
  const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
  settings = (resp && resp.settings) || {};
}

async function savePatch(patch) {
  const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
  const latest = (resp && resp.settings) || settings;
  Object.assign(latest, patch);
  settings = latest;
  await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings: latest });
  $('vSaveStatus').textContent = '✓ 已保存';
  $('vSaveStatus').className = 'status-saved';
  setTimeout(() => { $('vSaveStatus').textContent = '就绪'; $('vSaveStatus').className = ''; }, 1500);
}

// ============ 版本 ============
$('extVersion').textContent = 'v' + chrome.runtime.getManifest().version;

// ============ 侧栏切换 ============
document.querySelectorAll('.aero-nav .nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.aero-nav .nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.aero-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('panel-' + btn.dataset.panel).classList.add('active');
  });
});

// ============ 常规 ============
function bindToggle(id, key) {
  $(id).addEventListener('change', (e) => savePatch({ [key]: e.target.checked }));
}
function bindInput(id, key, parser = (v) => v) {
  $(id).addEventListener('change', (e) => savePatch({ [key]: parser(e.target.value) }));
}

bindToggle('vEnabled', 'enabled');
bindToggle('vStatusBar', 'showStatusBar');
bindToggle('vDebug', 'showDebugPanel');
bindToggle('vBadgeRecent', 'badgeVisibility.recent');
bindToggle('vBadgeAll', 'badgeVisibility.all');
bindToggle('vBadgeUpdate', 'badgeVisibility.update');
bindToggle('vBadgeRec', 'badgeVisibility.rec');
bindToggle('vSortByRating', 'enableSortByRating');
bindToggle('vRatingFilter', 'enableRatingFilter');
bindToggle('vRecentFilter', 'enableRecentFilter');
bindToggle('vVmFilter', 'enableVmFilter');
bindToggle('vUseLLM', 'useLLM');
bindToggle('vLogEnabled', 'enableLog');
bindInput('vMaxScan', 'maxScanLinks', Number);
bindInput('vVmKeywords', 'filterKeywords');
$('vFilterMatch').addEventListener('change', (e) => savePatch({ filterMatchMode: e.target.value }));
bindInput('vLlmEndpoint', 'llmConfig.endpoint');
bindInput('vLlmApiKey', 'llmConfig.apiKey');
bindInput('vLlmModel', 'llmConfig.model');
bindInput('vLogRetention', 'logRetentionDays', Number);
bindInput('vMaxLog', 'maxRuntimeLog', Number);

$('vThreshold').addEventListener('input', (e) => { $('vThresholdVal').textContent = e.target.value + '%'; });
$('vThreshold').addEventListener('change', (e) => savePatch({ highlightThreshold: e.target.value / 100 }));
$('vMinRating').addEventListener('input', (e) => { $('vMinRatingVal').textContent = e.target.value + '%'; });
$('vMinRating').addEventListener('change', (e) => savePatch({ minSteamRatingFilter: Number(e.target.value) }));
$('vMinRecentRating').addEventListener('input', (e) => { $('vMinRecentRatingVal').textContent = e.target.value + '%'; });
$('vMinRecentRating').addEventListener('change', (e) => savePatch({ minRecentSteamRatingFilter: Number(e.target.value) }));
$('vFilterMode').addEventListener('change', (e) => savePatch({ ratingFilterMode: e.target.value }));
$('vLlmTemp').addEventListener('input', (e) => { $('vLlmTempVal').textContent = e.target.value + '%'; });
$('vLlmTemp').addEventListener('change', (e) => savePatch({ 'llmConfig.temperature': e.target.value / 100 }));
$('vLlmProvider').addEventListener('change', (e) => savePatch({ 'llmConfig.provider': e.target.value }));
$('vItadKey').addEventListener('change', (e) => savePatch({ itadApiKey: e.target.value }));
$('vLogLevel').addEventListener('change', (e) => savePatch({ logLevel: e.target.value }));
$('vLogStorage').addEventListener('change', (e) => savePatch({ logStorage: e.target.value }));

// ============ 权重（动态 6 项） ============
const WEIGHT_KEYS = [
  ['clickRate', '点击率'],
  ['downloadRate', '下载率'],
  ['keywordMatch', '关键词'],
  ['steamRating', 'Steam 好评'],
  ['playTime', '游玩时长'],
  ['heat', '热度']
];
function renderWeights(w) {
  const box = $('vWeights');
  box.innerHTML = '';
  WEIGHT_KEYS.forEach(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'aero-row';
    row.innerHTML = `<span class="label">${label}<small>${key}</small></span>
      <input type="range" class="vista-range" data-w="${key}" min="0" max="100" step="5">
      <span class="vista-value" data-wv="${key}">0%</span>`;
    box.appendChild(row);
    const slider = row.querySelector('[data-w]');
    slider.value = Math.round((w[key] || 0) * 100);
    row.querySelector('[data-wv]').textContent = slider.value + '%';
    slider.addEventListener('change', async (e) => {
      const latest = (await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' })).settings;
      latest.weights = { ...(latest.weights || {}), [key]: Number(e.target.value) / 100 };
      await savePatch({ weights: latest.weights });
    });
  });
}

// ============ TTL（动态 7 类） ============
const TTL_KEYS = [
  ['steamDynamic', '好评率缓存', 'hours'],
  ['detailSteam', '详情页完整缓存', 'hours'],
  ['spySteam', 'SteamSpy 补充', 'days'],
  ['metaSteam', 'Steam 基础信息', 'days'],
  ['registryConfirm', '注册表重确认', 'days'],
  ['downloadUrls', '下载站网址', 'days'],
  ['negativeCache', '名称负缓存', 'hours']
];
function renderTtls(ttls) {
  const box = $('vTtls');
  box.innerHTML = '';
  TTL_KEYS.forEach(([key, label, unit]) => {
    const row = document.createElement('div');
    row.className = 'aero-row';
    row.innerHTML = `<span class="label">${label}<small>${key}</small></span>
      <input type="number" class="vista-input" data-t="${key}" min="0" max="365" style="width:90px">
      <span class="vista-tag blue">${unit}</span>`;
    box.appendChild(row);
    const t = ttls[key] || {};
    row.querySelector('[data-t]').value = t.value || 0;
    row.querySelector('[data-t]').addEventListener('change', async (e) => {
      const latest = (await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' })).settings;
      latest.cacheTtls = { ...(latest.cacheTtls || {}), [key]: { value: Number(e.target.value), unit } };
      await savePatch({ cacheTtls: latest.cacheTtls });
    });
  });
}

// ============ 限免 ============
async function loadFreeGames(force = false) {
  const resp = await chrome.runtime.sendMessage({ action: 'GET_FREE_GAMES', force });
  const data = resp && resp.games;
  const games = (data && data.games) || [];
  $('vFreeCount').textContent = games.length + ' 款';
  const now = Date.now();
  const fresh = games.filter((g) => g.firstSeen && now - g.firstSeen < 86400e3).length;
  $('vFreeUpdate').textContent = data && data.lastUpdate ? `更新于 ${new Date(data.lastUpdate).toLocaleString('zh-CN')} · 今日新增 ${fresh}` : '';
  const box = $('vFreeList');
  box.innerHTML = '';
  games.slice(0, 24).forEach((g) => {
    const typeTag =
      g.freeType === 'weekend' ? '<span class="vista-tag orange">⚠️ 免费周末</span>'
      : g.freeType === 'f2p' ? '<span class="vista-tag gray">❌ 永久免费</span>'
      : '<span class="vista-tag green">✅ 限时领取</span>';
    const card = document.createElement('div');
    card.className = 'free-card';
    card.innerHTML = `<div class="name">${escapeHtml(g.name)}</div>
      <div class="meta"><span class="vista-tag blue">${escapeHtml(g.platformName || g.platform)}</span>${typeTag}
      ${g.endTime ? '<span class="vista-tag gray">至 ' + escapeHtml(g.endTime.slice(0, 10)) + '</span>' : ''}</div>
      <div class="actions"><a class="vista-btn" href="${escapeAttr(g.url)}" target="_blank">🎁 去领取</a>
      ${g.claimed ? '<span class="vista-tag green" style="margin-left:6px;">已领取</span>' : ''}</div>`;
    box.appendChild(card);
  });
}
$('vRefreshFree').addEventListener('click', () => loadFreeGames(true));

// ============ 缓存管理 ============
async function loadCacheList() {
  const resp = await chrome.runtime.sendMessage({ action: 'GET_GAME_CACHE_LIST', keyword: $('vCacheKeyword').value || undefined });
  const list = (resp && resp.entries) || [];
  const box = $('vCacheList');
  box.innerHTML = '';
  list.slice(0, 50).forEach((e) => {
    const row = document.createElement('div');
    row.className = 'aero-row';
    row.innerHTML = `<span class="label">${escapeHtml(e.name || e.appId)}<small>appId ${escapeHtml(String(e.appId))} · ${e.positiveRate != null ? e.positiveRate + '%' : '无好评'}</small></span>
      <button class="vista-btn gray" data-del="${e.appId}">删除</button>`;
    box.appendChild(row);
    row.querySelector('[data-del]').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ action: 'DELETE_GAME_CACHE_ENTRY', appId: String(e.appId) });
      loadCacheList();
    });
  });
  if (list.length === 0) box.innerHTML = '<div style="color:var(--aero-text-dim);font-size:12px;">无缓存条目</div>';
}
$('vCacheSearch').addEventListener('click', loadCacheList);
$('vCacheKeyword').addEventListener('keypress', (e) => { if (e.key === 'Enter') loadCacheList(); });
$('vCacheClearAll').addEventListener('click', async () => {
  if (!confirm('确定清空全部游戏缓存？')) return;
  await chrome.runtime.sendMessage({ action: 'CLEAR_GAME_CACHE' });
  loadCacheList();
});

// ============ 数据管理 ============
$('vExport').addEventListener('click', async () => {
  const resp = await chrome.runtime.sendMessage({ action: 'EXPORT_DATA' });
  if (resp && resp.data) {
    const blob = new Blob([JSON.stringify(resp.data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'game-radar-export.json';
    a.click();
  }
});
$('vBackup').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'CREATE_BACKUP' });
  loadBackups();
});
$('vImportBtn').addEventListener('click', () => $('vImportFile').click());
$('vImportFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const resp = await chrome.runtime.sendMessage({ action: 'IMPORT_DATA', data: JSON.parse(text) });
  alert(resp && resp.success ? '导入成功' : '导入失败：' + (resp && resp.error || ''));
  loadBackups();
});
$('vClearData').addEventListener('click', async () => {
  if (!confirm('确定清空全部数据？此操作不可恢复！')) return;
  await chrome.runtime.sendMessage({ action: 'CLEAR_DATA' });
  init();
});
async function loadBackups() {
  const resp = await chrome.runtime.sendMessage({ action: 'GET_BACKUPS' });
  const backups = (resp && resp.backups) || [];
  const box = $('vBackupList');
  box.innerHTML = '<div class="aero-row" style="font-size:12px;color:var(--aero-text-dim);">备份列表</div>';
  backups.slice(0, 5).forEach((b) => {
    const row = document.createElement('div');
    row.className = 'aero-row';
    row.innerHTML = `<span class="label">${b.manual ? '手动' : '自动'} · ${new Date(b.timestamp).toLocaleString('zh-CN')}<small>${(b.modules || []).length} 个模块</small></span>
      <button class="vista-btn" data-restore="${b.id}">恢复</button>`;
    box.appendChild(row);
    row.querySelector('[data-restore]').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ action: 'RESTORE_BACKUP', backupId: b.id });
      alert('已恢复');
      init();
    });
  });
}

// ============ 统计 ============
async function loadStats() {
  const resp = await chrome.runtime.sendMessage({ action: 'GET_STATS' });
  if (!resp) return;
  $('vStatTotal').textContent = resp.totalEvents ?? 0;
  $('vStatGames').textContent = resp.totalGames ?? 0;
  $('vStatViews').textContent = resp.viewDetailCount ?? 0;
  $('vStatDownloads').textContent = resp.downloadCount ?? 0;
  const cs = resp.cacheStats || {};
  const total = (cs.hits || 0) + (cs.misses || 0);
  $('vStatCache').textContent = total > 0 ? Math.round((cs.hits / total) * 100) + '%' : '无查询';
  const tbody = $('vRecentLog');
  tbody.innerHTML = '';
  (resp.recentLog || []).slice(0, 12).forEach((e) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${new Date(e.t).toLocaleTimeString('zh-CN')}</td><td>${escapeHtml(e.type)}</td><td>${escapeHtml(e.gameName || '')}</td>`;
    tbody.appendChild(tr);
  });
}

// ============ LLM 测试 ============
$('vTestLlm').addEventListener('click', async () => {
  $('vLlmResult').textContent = '测试中...';
  const cfg = settings.llmConfig || {};
  try {
    const resp = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {}) },
      body: JSON.stringify({ model: cfg.model, prompt: 'ping', stream: false }),
      signal: AbortSignal.timeout(10000)
    });
    $('vLlmResult').textContent = resp.ok ? '✅ 连接成功' : '❌ HTTP ' + resp.status;
  } catch (err) {
    $('vLlmResult').textContent = '❌ ' + String(err && err.message || err).slice(0, 60);
  }
});

// ============ ITAD Key：脱敏显示 + 保存 + 测试 ============
function maskKey(key) {
  if (!key) return '';
  return '••••' + String(key).slice(-4);
}
async function renderItad() {
  const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
  const key = (resp && resp.settings && resp.settings.itadApiKey) || '';
  settings = resp.settings;
  $('vItadKey').value = key ? maskKey(key) : '';
  $('vItadKey').dataset.masked = key ? '1' : '';
}
// 聚焦时清空掩码便于重输（保存后恢复掩码）
$('vItadKey').addEventListener('focus', () => {
  if ($('vItadKey').dataset.masked === '1') { $('vItadKey').value = ''; $('vItadKey').dataset.masked = ''; }
});
$('vItadSave').addEventListener('click', async () => {
  const val = $('vItadKey').value.trim();
  if (!val) { $('vItadMsg').textContent = '请输入 ITAD API Key'; return; }
  await savePatch({ itadApiKey: val });
  renderItad();
  $('vItadMsg').textContent = '✅ 已保存（脱敏显示）';
});
$('vItadTest').addEventListener('click', async () => {
  const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
  const key = (resp && resp.settings && resp.settings.itadApiKey) || '';
  if (!key) { $('vItadMsg').textContent = '⚠️ 请先保存 ITAD API Key'; return; }
  $('vItadMsg').textContent = '测试中...';
  try {
    const r = await fetch('https://api.isthereanydeal.com/v02/game/prices/?key=' + encodeURIComponent(key) + '&appids=steam/730');
    $('vItadMsg').textContent = r.status === 200 ? '✅ Key 有效' : r.status === 401 || r.status === 403 ? '❌ Key 无效（' + r.status + '）' : '⚠️ 服务异常（' + r.status + '）';
  } catch (err) {
    $('vItadMsg').textContent = '❌ 网络错误';
  }
});

// ============ 经典菜单切换 ============
$('toggleClassic').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  window.close();
});

// ============ 工具 ============
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escapeHtml(s); }

// ============ 初始化 ============
async function init() {
  await loadSettings();
  $('vEnabled').checked = !!settings.enabled;
  $('vThreshold').value = Math.round((settings.highlightThreshold ?? 0.6) * 100);
  $('vThresholdVal').textContent = $('vThreshold').value + '%';
  $('vStatusBar').checked = settings.showStatusBar !== false;
  $('vDebug').checked = !!settings.showDebugPanel;
  $('vMaxScan').value = settings.maxScanLinks || 500;
  const bv = settings.badgeVisibility || {};
  $('vBadgeRecent').checked = bv.recent !== false;
  $('vBadgeAll').checked = bv.all !== false;
  $('vBadgeUpdate').checked = bv.update !== false;
  $('vBadgeRec').checked = bv.rec !== false;
  $('vSortByRating').checked = !!settings.enableSortByRating;
  $('vRatingFilter').checked = !!settings.enableRatingFilter;
  $('vMinRating').value = settings.minSteamRatingFilter || 0;
  $('vMinRatingVal').textContent = $('vMinRating').value + '%';
  $('vRecentFilter').checked = !!settings.enableRecentFilter;
  $('vMinRecentRating').value = settings.minRecentSteamRatingFilter || 0;
  $('vMinRecentRatingVal').textContent = $('vMinRecentRating').value + '%';
  $('vFilterMode').value = settings.ratingFilterMode || 'and';
  $('vVmFilter').checked = !!settings.enableVmFilter;
  $('vVmKeywords').value = settings.filterKeywords || (Array.isArray(settings.vmFilterKeywords) ? settings.vmFilterKeywords.join(',') : '') || '';
  $('vFilterMatch').value = settings.filterMatchMode || 'contains';
  renderWeights(settings.weights || {});
  const llm = settings.llmConfig || {};
  $('vUseLLM').checked = !!settings.useLLM;
  $('vLlmProvider').value = llm.provider || 'local';
  $('vLlmEndpoint').value = llm.endpoint || '';
  $('vLlmApiKey').value = llm.apiKey || '';
  $('vLlmModel').value = llm.model || '';
  $('vLlmTemp').value = Math.round((llm.temperature || 0.3) * 100);
  $('vLlmTempVal').textContent = $('vLlmTemp').value + '%';
  renderItad();
  $('vLogEnabled').checked = settings.enableLog !== false;
  $('vLogLevel').value = settings.logLevel || 'info';
  $('vLogRetention').value = settings.logRetentionDays ?? 7;
  $('vLogStorage').value = settings.logStorage || 'ndjson';
  $('vMaxLog').value = settings.maxRuntimeLog || 300;
  renderTtls(settings.cacheTtls || {});
  loadFreeGames(false);
  loadBackups();
  loadCacheList();
  loadStats();
}

init().catch((e) => console.error('Vista 菜单加载失败:', e));
