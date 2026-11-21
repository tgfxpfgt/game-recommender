/**
 * 游戏雷达 Game Radar - Popup 快速搜索 / Popup Quick Search
 *
 * v14.3.0（第五轮 B6）：由 popup.js 拆分——Steam 候选快速搜索
 * （SEARCH_STEAM_CANDIDATES → 点击打开商店页；classic 脚本立即绑定，
 * popup.html 于 body 末尾加载，元素已就绪）。
 * Quick Steam search split from popup.js (binds at body-end load).
 */

// ============ 快速搜索（v7.4.0） ============
// Quick Steam search: candidates → click to open the store page
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchResults = document.getElementById('searchResults');

async function doSearch() {
  const name = (searchInput.value || '').trim();
  if (!name) return;
  searchResults.classList.remove('hidden');
  searchResults.textContent = '搜索中…';
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'SEARCH_STEAM_CANDIDATES', gameName: name });
    const cands = (resp && resp.candidates) || [];
    if (cands.length === 0) {
      searchResults.textContent = '未找到匹配的 Steam 游戏';
      return;
    }
    // v15 阶段 3 全量迁移：结果行 Preact 渲染（原 createElement 循环 + 清场退役；
    // onClick prop 直连）
    const PP = /** @type {any} */ (globalThis).__GR_PREACT__;
    PP.render(
      PP.h(
        PP.Fragment,
        null,
        cands.slice(0, 6).map((/** @type {any} */ c) =>
          PP.h(
            'div',
            {
              class: 'search-result-row',
              key: String(c.appId),
              title: '打开 Steam 商店页 (App ID ' + c.appId + ')',
              onClick: () => {
                chrome.tabs.create({ url: 'https://store.steampowered.com/app/' + c.appId + '/' });
                window.close();
              }
            },
            String(c.name)
          )
        )
      ),
      searchResults
    );
  } catch (e) {
    searchResults.textContent = '搜索失败：' + String(e);
  }
}
if (searchInput && searchBtn) {
  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (/** @type {KeyboardEvent} */ ev) => {
    if (ev.key === 'Enter') doSearch();
  });
}
