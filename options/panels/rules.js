/**
 * 游戏雷达 Game Radar - 规则管理面板模块 / Adapter Rules Panel
 *
 * v3.0.0：站点适配规则的查看、JSON 编辑（前端校验 + 后台二次校验）、
 * 保存覆盖内置、恢复内置、独立导出/导入。
 * View & edit download-site adapter rules as JSON; save overrides the built-in
 * rules; reset to built-in; standalone export/import.
 */
(function (global) {
  'use strict';

  const OPTS = (global.__OPTS__ = global.__OPTS__ || {});

  // ============ 事件绑定 / Event binding ============
  function bindRulesEvents() {
    const $ = (id) => document.getElementById(id);
    $('ruleSave').addEventListener('click', saveRules);
    $('ruleValidate').addEventListener('click', validateEditor);
    $('ruleFormat').addEventListener('click', formatEditor);
    $('ruleSelfCheck').addEventListener('click', selfCheckRules);
    $('ruleResetBuiltin').addEventListener('click', resetToBuiltin);
    $('ruleExport').addEventListener('click', exportRules);
    $('ruleImport').addEventListener('click', () => $('ruleImportFile').click());
    $('ruleImportFile').addEventListener('change', importRulesFile);
  }

  // 切换到规则面板时加载 / Load rules when the panel opens
  async function loadRules() {
    try {
      const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_ADAPTER_RULES' });
      if (!resp) return;
      OPTS.ruleData = resp; // {builtin, imported, merged}
      renderRuleSource(resp);
      renderRuleList(resp.merged);
      // 编辑器展示生效规则（已导入优先）
      document.getElementById('ruleEditor').value = JSON.stringify(resp.merged, null, 2);
      setRuleStatus(resp.imported ? '已加载用户导入规则，编辑后保存将覆盖' : '当前使用内置规则', 'info');
    } catch (e) {
      setRuleStatus('加载规则失败: ' + String(e), 'error');
    }
  }

  // 来源标识 / Source indicator
  function renderRuleSource(data) {
    const el = document.getElementById('ruleSource');
    const importedCount = data.imported ? data.imported.sites.length : 0;
    const builtinCount = data.builtin ? data.builtin.sites.length : 0;
    el.innerHTML =
      importedCount > 0
        ? `📥 已导入规则 <b>${importedCount}</b> 个站点（覆盖内置 ${builtinCount} 个）`
        : `📦 内置规则 <b>${builtinCount}</b> 个站点`;
  }

  // 规则列表（展示 + v10.8 F1：features 勾选行——勾选即回写编辑器 JSON，
  // 保存走 ruleSave 原链路）/ Rule list with per-site feature checkboxes that
  // patch the editor JSON (save via the normal ruleSave flow).
  const FEATURE_FLAGS = [
    ['inlineSteamCard', '内嵌 Steam 卡'],
    ['gridLayoutDefault', '布局定制默认开'],
    ['detailMetaVersion', '版本号解析']
  ];
  function renderRuleList(merged) {
    const el = document.getElementById('ruleList');
    const sites = (merged && merged.sites) || [];
    if (sites.length === 0) {
      el.innerHTML = '<div class="no-data">无规则</div>';
      return;
    }
    el.innerHTML = sites
      .map((s) => {
        const f = s.features || {};
        const checks = FEATURE_FLAGS.map(
          ([flag, label]) => `
          <label class="rule-feature-check" title="features.${escapeHtml(flag)}">
            <input type="checkbox" data-site="${escapeHtml(s.key)}" data-flag="${escapeHtml(flag)}" ${f[flag] === true ? 'checked' : ''}/>
            ${escapeHtml(label)}
          </label>`
        ).join('');
        return `
      <div class="rule-item">
        <div class="rule-item-head">
          <span class="rule-item-key">${escapeHtml(s.key)}</span>
          <span class="rule-item-name">${escapeHtml(s.name)}</span>
          ${s.searchUrl ? '<span class="rule-item-tag">🔍 可检索</span>' : ''}
        </div>
        <div class="rule-item-meta">域名: ${escapeHtml(Array.isArray(s.domains) ? s.domains.join(', ') : String(s.domains ?? ''))}</div>
        ${Array.isArray(s.detailUrlPatterns) ? `<div class="rule-item-meta">详情: ${escapeHtml(s.detailUrlPatterns.join(' | '))}</div>` : ''}
        ${s.listItem && Array.isArray(s.listItem.containers) ? `<div class="rule-item-meta">容器: ${escapeHtml(s.listItem.containers.join(' | '))}</div>` : ''}
        <div class="rule-item-features">${checks}</div>
      </div>`;
      })
      .join('');
    // 勾选 → 回写编辑器 JSON（非法 JSON 时还原勾选并提示）
    el.querySelectorAll('.rule-feature-check input').forEach((cb) => {
      cb.addEventListener('change', () => {
        const siteKey = cb.dataset.site;
        const flag = cb.dataset.flag;
        const prev = !cb.checked;
        const parsed = parseEditor();
        if (!parsed) {
          cb.checked = prev; // 编辑器 JSON 当前非法 → 还原勾选
          return;
        }
        const site = (parsed.sites || []).find((x) => x && x.key === siteKey);
        if (!site) {
          cb.checked = prev;
          setRuleStatus(`未在编辑器 JSON 中找到站点 "${siteKey}"（可能已被手动删除）`, 'error');
          return;
        }
        site.features = site.features || {};
        site.features[flag] = cb.checked;
        document.getElementById('ruleEditor').value = JSON.stringify(parsed, null, 2);
        setRuleStatus(`已更新 ${siteKey}.features.${flag}=${cb.checked}——请点击「保存规则」生效`, 'info');
      });
    });
  }

  // ============ 编辑器操作 / Editor actions ============
  // 前端结构校验（后台 SAVE 时二次校验）
  // Front-end structural check (backend re-validates on save)
  function parseEditor() {
    const raw = document.getElementById('ruleEditor').value;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      setRuleStatus('JSON 解析失败: ' + String(e), 'error');
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setRuleStatus('规则必须是 JSON 对象（含 version 与 sites）', 'error');
      return null;
    }
    if (typeof parsed.version !== 'number') {
      setRuleStatus('缺少 version 字段（数字，如 1）', 'error');
      return null;
    }
    if (!Array.isArray(parsed.sites) || parsed.sites.length === 0) {
      setRuleStatus('缺少 sites 数组且不能为空', 'error');
      return null;
    }
    return parsed;
  }

  function validateEditor() {
    const parsed = parseEditor();
    if (!parsed) return;
    setRuleStatus(`✅ 结构校验通过：${parsed.sites.length} 个站点（保存时后台将再次校验）`, 'ok');
  }

  function formatEditor() {
    const parsed = parseEditor();
    if (!parsed) return;
    document.getElementById('ruleEditor').value = JSON.stringify(parsed, null, 2);
    setRuleStatus('已格式化', 'info');
  }

  async function saveRules() {
    const parsed = parseEditor();
    if (!parsed) return;
    try {
      const resp = await window.__GR_MSG__.sendMessage({ action: 'SAVE_ADAPTER_RULES', rules: parsed });
      if (resp && resp.ok) {
        setRuleStatus(`✅ 已保存 ${parsed.sites.length} 个站点规则（覆盖内置）；刷新已打开的下载站页面后生效`, 'ok');
        await loadRules();
        // v10.0.0：保存后展示逐站诊断（结构性合法但影响功能的配置问题）
        renderRuleDiagnostics(resp.diagnostics || []);
      } else {
        setRuleStatus('保存失败: ' + ((resp && resp.error) || '校验未通过'), 'error');
      }
    } catch (e) {
      setRuleStatus('保存失败: ' + String(e), 'error');
    }
  }

  // v10.0.0：逐站诊断渲染（warn 红 / info 灰）/ per-site diagnostics render
  function renderRuleDiagnostics(diagnostics) {
    const box = document.getElementById('ruleDiagnostics');
    if (!box) return;
    if (!diagnostics || diagnostics.length === 0) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    box.style.display = 'block';
    box.innerHTML = diagnostics
      .map((d) => {
        const esc = (t) => globalThis.escapeHtml(t); // v10.7.0：口径统一 shared/escape.js（原实现不转义引号）
        const color = d.level === 'warn' ? '#e67e22' : '#8f98a0';
        return `<div style="color:${color};">⚠ [${esc(d.site)}] ${esc(d.message)}</div>`;
      })
      .join('');
  }

  // v10.0.0：规则健康自检——逐站展示"配置诊断 + 运行时改版告警"
  // Rule-pack self-check: config diagnostics per site + runtime redesign alerts
  async function selfCheckRules() {
    const box = document.getElementById('ruleDiagnostics');
    try {
      const [rulesResp, healthResp] = await Promise.all([
        window.__GR_MSG__.sendMessage({ action: 'GET_ADAPTER_RULES' }),
        window.__GR_MSG__.sendMessage({ action: 'GET_SITE_HEALTH' })
      ]);
      const sites = ((rulesResp && rulesResp.merged) || {}).sites || [];
      const alerts = (healthResp && healthResp.sites) || [] || [];
      const alertByKey = {};
      for (const a of alerts) alertByKey[a.siteKey] = a;
      const esc = (t) => globalThis.escapeHtml(t); // v10.7.0：口径统一 shared/escape.js（原实现不转义引号）
      const lines = [];
      for (const s of sites) {
        const alert = alertByKey[s.key];
        if (alert) {
          lines.push(
            `<div style="color:#e74c3c;">✖ [${esc(s.key)}] 疑似改版失效（${esc(alert.host || '?')}）— ` +
              `${alert.alertCount} 次告警，最近 ${new Date(alert.lastAlertAt || Date.now()).toLocaleString()}</div>`
          );
        } else {
          lines.push(`<div style="color:#67c1f5;">✓ [${esc(s.key)}] 正常（无改版告警）</div>`);
        }
      }
      if (box) {
        box.style.display = 'block';
        box.innerHTML = '<div style="font-weight:bold;">🩺 规则健康自检：</div>' + lines.join('');
      }
      if (!lines.length && box) {
        box.style.display = 'block';
        box.innerHTML = '<div style="color:#8f98a0;">无站点规则可检查</div>';
      }
    } catch (e) {
      if (box) {
        box.style.display = 'block';
        box.innerHTML = `<div style="color:#e74c3c;">自检失败: ${String(e).replace(/</g, '&lt;')}</div>`;
      }
    }
  }

  async function resetToBuiltin() {
    if (!confirm('删除用户导入的规则并恢复内置规则？')) return;
    try {
      const resp = await window.__GR_MSG__.sendMessage({ action: 'DELETE_ADAPTER_RULES' });
      if (resp && resp.ok) {
        setRuleStatus('✅ 已恢复内置规则；刷新已打开的下载站页面后生效', 'ok');
        await loadRules();
      } else {
        // v9.7.0：补失败分支——此前仅成功分支存在，失败时界面毫无反馈
        setRuleStatus('恢复失败: ' + ((resp && resp.error) || '未知错误'), 'error');
      }
    } catch (e) {
      setRuleStatus('恢复失败: ' + String(e), 'error');
    }
  }

  // ============ 导出 / 导入 / Export & import ============
  function exportRules() {
    const data = (OPTS.ruleData && OPTS.ruleData.merged) || null;
    if (!data) {
      setRuleStatus('暂无规则可导出', 'error');
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `game-recommender-rules-${data.sites.length}-sites.json`;
    a.click();
    URL.revokeObjectURL(url);
    setRuleStatus('✅ 已导出规则 JSON', 'ok');
  }

  async function importRulesFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // 允许重复导入同一文件
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      document.getElementById('ruleEditor').value = JSON.stringify(parsed, null, 2);
      const parsed2 = parseEditor(); // 结构校验后直接保存
      if (!parsed2) return;
      const resp = await window.__GR_MSG__.sendMessage({ action: 'SAVE_ADAPTER_RULES', rules: parsed2 });
      if (resp && resp.ok) {
        setRuleStatus(`✅ 导入成功：${parsed2.sites.length} 个站点规则已生效；刷新已打开的下载站页面后生效`, 'ok');
        await loadRules();
      } else {
        setRuleStatus('导入失败: ' + ((resp && resp.error) || '校验未通过'), 'error');
      }
    } catch (err) {
      setRuleStatus('导入文件解析失败: ' + String(err), 'error');
    }
  }

  function setRuleStatus(text, type) {
    const el = document.getElementById('ruleStatus');
    el.textContent = text;
    el.className = 'rule-status ' + (type || 'info');
  }

  OPTS.bindRulesEvents = bindRulesEvents;
  OPTS.loadRules = loadRules;
})(typeof globalThis !== 'undefined' ? globalThis : this);
