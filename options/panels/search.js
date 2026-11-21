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

  // v15 阶段 3：Preact 垫片惰性访问器（classic 页面脚本——加载序在垫片之前）
  /** @returns {{h: Function, render: Function, Fragment: any}} */
  function P() {
    return /** @type {any} */ (globalThis).__GR_PREACT__;
  }

  // ============ 设置搜索（v11.0 B6：按行文本过滤；纯前端，不改保存逻辑） ============
  // Settings search: filter setting rows by text (front-end only).
  function bindSettingsSearch() {
    // v14.11 B5：侧栏搜索（sidebarSearch）与面板头搜索（settingsSearch）双绑——
    // 此前两处重复 id="settingsSearch"，面板头为死控件（getElementById 恒取首个）
    const inputs = ['settingsSearch', 'sidebarSearch'].map((id) => document.getElementById(id)).filter(Boolean);
    if (inputs.length === 0) return;
    /** @param {{target?: {value?: string}}} [ev] */
    const onSearch = (ev) => {
      const q = String((ev && ev.target && ev.target.value) || inputs[0].value || '')
        .trim()
        .toLowerCase();
      document.querySelectorAll('.settings-panel .setting-row').forEach((/** @type {any} */ row) => {
        row.style.display = !q || (row.textContent || '').toLowerCase().includes(q) ? '' : 'none';
      });
      document.querySelectorAll('.settings-panel .settings-section').forEach((/** @type {any} */ sec) => {
        const visible = [...sec.querySelectorAll('.setting-row')].some((r) => r.style.display !== 'none');
        sec.style.display = visible || !q ? '' : 'none';
      });
    };
    // 双输入共用同一过滤回调（侧栏/面板头任一输入均生效）
    inputs.forEach((input) => input.addEventListener('input', onSearch));
  }

  // ============ 关键词过滤规则编辑器（v6.4.8：多条 + 排除误报词） ============
  // Keyword filter-rule editor: multiple rules, each with false-positive excludes.
  // v15 阶段 3 全量迁移：规则行 Preact h() 渲染（innerHTML 3 处退役——
  // value 经 prop 绑定天然安全；删除 onClick prop 直连；容器 change 委托保留）
  /** @param {any[]} rules */
  function renderRules(rules) {
    // v14.11 B5：id 改 keywordRuleList——原 ruleList 与规则管理面板重复，
    // getElementById 恒取首个致规则管理面板恒空（报告 B/C/D 三报共振）
    const box = document.getElementById('keywordRuleList');
    if (!box) return;
    const PP = P();
    if (!rules || rules.length === 0) {
      PP.render(
        PP.h(
          'div',
          { style: 'font-size:12px;color:#8f98a0;' },
          '暂无规则——添加后生效（关键词命中且不命中排除词才过滤）'
        ),
        box
      );
      return;
    }
    const rows = (rules || []).map((/** @type {any} */ rule, /** @type {number} */ idx) =>
      PP.h(
        'div',
        { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px;', key: idx },
        PP.h('input', {
          type: 'text',
          class: 'text-input',
          'data-rk': idx,
          placeholder: '关键词',
          value: rule.keyword || '',
          style: 'flex:1'
        }),
        PP.h('span', { style: 'font-size:11px;color:#8f98a0;' }, '排除'),
        PP.h('input', {
          type: 'text',
          class: 'text-input',
          'data-rx': idx,
          placeholder: '排除误报词（可空）',
          value: rule.exclude || '',
          style: 'flex:1'
        }),
        PP.h(
          'button',
          {
            class: 'btn btn-danger',
            style: 'padding:4px 10px;',
            onClick: () => {
              const rules2 = /** @type {any[]} */ (OPTS.currentSettings.filterRules || []).filter(
                (/** @type {any} */ _r, /** @type {number} */ i) => i !== idx
              );
              OPTS.currentSettings.filterRules = rules2;
              renderRules(rules2);
              OPTS.scheduleAutoSave();
            }
          },
          '✕'
        )
      )
    );
    PP.render(PP.h(PP.Fragment, null, rows), box);
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
      const rules2 = /** @type {any[]} */ (OPTS.currentSettings.filterRules || []).map(
        (/** @type {any} */ r, /** @type {number} */ i) => {
          if (String(i) === kIdx) return { ...r, keyword: el.value };
          if (String(i) === xIdx) return { ...r, exclude: el.value };
          return r;
        }
      );
      OPTS.currentSettings.filterRules = rules2;
      OPTS.scheduleAutoSave();
    });
    /** @type {Record<string, any>} */ (global)['__renderRules'] = renderRules;
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
    const filtered = logs.filter((/** @type {any} */ l) => {
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
    const PP = P();
    if (filtered.length === 0) {
      PP.render(PP.h('div', { style: 'color:#8f98a0;' }, '暂无匹配日志'), box);
      return;
    }
    PP.render(
      PP.h(
        PP.Fragment,
        null,
        filtered.slice(0, 200).map((/** @type {any} */ l, /** @type {number} */ i) => {
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
          return PP.h(
            'div',
            { style: 'padding:2px 4px;border-bottom:1px solid #2f4055;display:flex;gap:6px;', key: i },
            PP.h('span', { style: 'color:#8f98a0;white-space:nowrap;' }, time),
            PP.h('span', { style: `color:${color};font-weight:600;white-space:nowrap;` }, `[${l.level || 'info'}]`),
            PP.h('span', { style: 'color:#4a7ab5;white-space:nowrap;' }, l.module || ''),
            PP.h('span', { style: 'flex:1;' }, l.message || l.msg || '')
          );
        })
      ),
      box
    );
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
