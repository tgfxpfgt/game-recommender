/**
 * 游戏雷达 Game Radar - 搜索与过滤面板模块 / Search & Filter Panel
 *
 * v14 B2：由 options.js 拆分——设置搜索过滤（v11.0 B6）、关键词过滤规则
 * 编辑器（v6.4.8）、运行日志在线查看（级别筛选 + 关键词搜索 + 日志配置绑定）。
 * Split from options.js (B2): settings search, keyword filter-rule editor,
 * runtime log viewer (level filter + keyword search) and log-config bindings.
 * 共享状态与保存方法经 window.__OPTS__ 访问（普通页面脚本顺序加载）。
 */
(function (global) {
  'use strict';

  const OPTS = (global.__OPTS__ = global.__OPTS__ || {});

  // ============ 设置搜索（v11.0 B6：按行文本过滤；纯前端，不改保存逻辑） ============
  // Settings search: filter setting rows by text (front-end only).
  function bindSettingsSearch() {
    const input = document.getElementById('settingsSearch');
    if (!input) return;
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      document.querySelectorAll('.settings-panel .setting-row').forEach((row) => {
        row.style.display = !q || (row.textContent || '').toLowerCase().includes(q) ? '' : 'none';
      });
      document.querySelectorAll('.settings-panel .settings-section').forEach((sec) => {
        const visible = [...sec.querySelectorAll('.setting-row')].some((r) => r.style.display !== 'none');
        sec.style.display = visible || !q ? '' : 'none';
      });
    });
  }

  // ============ 关键词过滤规则编辑器（v6.4.8：多条 + 排除误报词） ============
  // Keyword filter-rule editor: multiple rules, each with false-positive excludes.
  function renderRules(rules) {
    const box = document.getElementById('ruleList');
    if (!box) return;
    box.innerHTML = '';
    (rules || []).forEach((rule, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;';
      // v9.7.0：value 属性转义改用统一 escapeAttr（shared/escape.js 全局注入）——
      // 此前只转义双引号，含 &quot; 等实体样式的关键词会显示错乱
      row.innerHTML = `<input type="text" class="text-input" data-rk="${idx}" placeholder="关键词" value="${escapeAttr(rule.keyword || '')}" style="flex:1">
          <span style="font-size:11px;color:#8f98a0;">排除</span>
          <input type="text" class="text-input" data-rx="${idx}" placeholder="排除误报词（可空）" value="${escapeAttr(rule.exclude || '')}" style="flex:1">
          <button class="btn btn-danger" data-rdel="${idx}" style="padding:4px 10px;">✕</button>`;
      box.appendChild(row);
      row.querySelector('[data-rdel]').addEventListener('click', () => {
        const rules2 = (OPTS.currentSettings.filterRules || []).filter((_, i) => i !== idx);
        OPTS.currentSettings.filterRules = rules2;
        renderRules(rules2);
        OPTS.scheduleAutoSave();
      });
    });
    if (!rules || rules.length === 0) {
      box.innerHTML =
        '<div style="font-size:12px;color:#8f98a0;">暂无规则——添加后生效（关键词命中且不命中排除词才过滤）</div>';
    }
  }

  function bindFilterRules() {
    document.getElementById('ruleAddBtn').addEventListener('click', () => {
      OPTS.currentSettings.filterRules = [...(OPTS.currentSettings.filterRules || []), { keyword: '', exclude: '' }];
      renderRules(OPTS.currentSettings.filterRules);
      OPTS.scheduleAutoSave();
    });
    document.addEventListener('change', (e) => {
      const el = /** @type {HTMLInputElement} */ (e.target);
      const kIdx = el && el.dataset && el.dataset.rk;
      const xIdx = el && el.dataset && el.dataset.rx;
      if (kIdx === undefined && xIdx === undefined) return;
      const rules2 = (OPTS.currentSettings.filterRules || []).map((r, i) => {
        if (String(i) === kIdx) return { ...r, keyword: el.value };
        if (String(i) === xIdx) return { ...r, exclude: el.value };
        return r;
      });
      OPTS.currentSettings.filterRules = rules2;
      OPTS.scheduleAutoSave();
    });
    global['__renderRules'] = renderRules;
    // v6.4.11：renderSettings 先于本定义执行，首次加载时规则列表缺失 → 补渲染
    if (OPTS.currentSettings) renderRules(OPTS.currentSettings.filterRules || []);
  }

  // ============ 运行日志在线查看（v6.4.8/6.4.19：级别筛选 + 关键词搜索 + 模块显示） ============
  // Runtime log viewer: level filter + keyword search + module display.
  async function loadLogViewer() {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_RUNTIME_LOGS', limit: 300 });
    const logs = (resp && resp.logs) || [];
    const levelFilter = document.getElementById('logLevelFilter').value;
    const search = document.getElementById('logSearch').value.trim().toLowerCase();
    const filtered = logs.filter((l) => {
      if (levelFilter && l.level !== levelFilter) return false;
      if (
        search &&
        !(l.message || '').toLowerCase().includes(search) &&
        !(l.module || '').toLowerCase().includes(search)
      )
        return false;
      return true;
    });
    document.getElementById('logCount').textContent = filtered.length + ' / ' + logs.length + ' 条';
    const box = document.getElementById('logViewer');
    box.innerHTML =
      filtered.length === 0
        ? '<div style="color:#8f98a0;">暂无匹配日志</div>'
        : filtered
            .slice(0, 200)
            .map((l) => {
              const color =
                l.level === 'error'
                  ? '#c75050'
                  : l.level === 'warn'
                    ? '#c78550'
                    : l.level === 'debug'
                      ? '#8f98a0'
                      : '#66c0f4';
              const dt = new Date(l.timestamp || l.t); // v10.9.1：Invalid Date 兜底
              const time = isNaN(dt.getTime()) ? '-' : dt.toLocaleTimeString('zh-CN');
              return `<div style="padding:2px 4px;border-bottom:1px solid #2f4055;display:flex;gap:6px;">
              <span style="color:#8f98a0;white-space:nowrap;">${time}</span>
              <span style="color:${color};font-weight:600;white-space:nowrap;">[${escapeHtml(l.level || 'info')}]</span>
              <span style="color:#4a7ab5;white-space:nowrap;">${escapeHtml(l.module || '')}</span>
              <span style="flex:1;">${escapeHtml(l.message || l.msg || '')}</span>
            </div>`;
            })
            .join('');
  }

  function bindLogViewer() {
    document.getElementById('logRefreshBtn').addEventListener('click', loadLogViewer);
    document.getElementById('logClearBtn').addEventListener('click', async () => {
      await window.__GR_MSG__.sendMessage({ action: 'CLEAR_RUNTIME_LOGS' });
      loadLogViewer();
    });
    document.getElementById('logLevelFilter').addEventListener('change', loadLogViewer);
    document.getElementById('logSearch').addEventListener('input', loadLogViewer);
    setTimeout(loadLogViewer, 300);
  }

  // 日志配置输入（变更即自动保存；收集在 options.js saveSettings）
  function bindLogConfigEvents() {
    document.getElementById('logEnabled').addEventListener('change', () => OPTS.scheduleAutoSave());
    document.getElementById('logLevel').addEventListener('change', () => OPTS.scheduleAutoSave());
    document.getElementById('logRetentionDays').addEventListener('change', () => OPTS.scheduleAutoSave());
    document.getElementById('logStorage').addEventListener('change', () => OPTS.scheduleAutoSave());
    document.getElementById('maxRuntimeLog').addEventListener('change', () => OPTS.scheduleAutoSave());
  }

  OPTS.bindSettingsSearch = bindSettingsSearch;
  OPTS.bindFilterRules = bindFilterRules;
  OPTS.bindLogViewer = bindLogViewer;
  OPTS.bindLogConfigEvents = bindLogConfigEvents;
})(typeof globalThis !== 'undefined' ? globalThis : this);
