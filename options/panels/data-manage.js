/**
 * Game Recommender - 数据管理面板模块 / Data Management Panel
 *
 * 数据模块勾选（自定义备份/导入/导出）、导出/导入（JSON 单文件）、
 * 模块化备份创建/恢复、清除数据与恢复默认设置。
 * Data-module selection, JSON export/import, modular backup create/restore,
 * data clearing and settings reset.
 */
(function (global) {
  'use strict';

  const OPTS = (global.__OPTS__ = global.__OPTS__ || {});

  // ============ 数据模块管理 / Data Module Management ============
  let dataModules = [];
  let selectedModules = new Set();

  // 加载模块清单（含条目数）并渲染勾选 UI
  async function loadDataModules() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'GET_DATA_MODULES' });
      dataModules = (resp && resp.modules) || [];
      selectedModules = new Set(dataModules.map((m) => m.key)); // 默认全选
      renderModuleChecks();
    } catch (e) {
      console.error('加载数据模块失败:', e);
    }
  }

  // 渲染模块勾选列表
  function renderModuleChecks() {
    const container = document.getElementById('moduleCheckList');
    if (!container) return;
    container.innerHTML = dataModules
      .map(
        (m) => `
      <label class="module-check-item">
        <input type="checkbox" class="module-check" data-module="${escapeAttr(m.key)}" ${selectedModules.has(m.key) ? 'checked' : ''}>
        <span class="module-check-name">${escapeHtml(m.name)}</span>
        <small class="module-check-desc">${escapeHtml(m.desc)}${m.count ? ` · ${m.count} 条` : ''}</small>
      </label>
    `
      )
      .join('');
    container.querySelectorAll('.module-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedModules.add(cb.dataset.module);
        else selectedModules.delete(cb.dataset.module);
      });
    });
  }

  // 获取当前勾选的模块键
  function getSelectedModuleKeys() {
    return [...selectedModules];
  }

  // 显示操作状态
  function showDataOpStatus(text, isError = false) {
    const el = document.getElementById('dataOpStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'data-op-status ' + (isError ? 'error' : 'ok');
    setTimeout(() => {
      el.textContent = '';
    }, 4000);
  }

  // ============ Data Management / 数据管理 ============
  async function exportData() {
    const keys = getSelectedModuleKeys();
    if (keys.length === 0) {
      alert('请先勾选要导出的数据类型');
      return;
    }
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'EXPORT_DATA', moduleKeys: keys });
      if (!resp || !resp.success || !resp.data) {
        showDataOpStatus('导出失败', true);
        return;
      }
      const blob = new Blob([JSON.stringify(resp.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `game-recommender-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showDataOpStatus(`✅ 已导出 ${keys.length} 个模块`);
    } catch (e) {
      showDataOpStatus('导出失败: ' + String(e), true);
    }
  }

  async function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      // 校验导出文件格式
      if (!payload || payload.format !== 'game-recommender-backup') {
        throw new Error('不是有效的 Game Recommender 导出文件');
      }
      const keys = getSelectedModuleKeys();
      const resp = await chrome.runtime.sendMessage({
        action: 'IMPORT_DATA',
        data: payload,
        moduleKeys: keys
      });
      if (resp && resp.success) {
        // 重新加载设置与模块数据
        const sr = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
        if (sr && sr.settings) {
          OPTS.currentSettings = sr.settings;
          OPTS.renderSettings(OPTS.currentSettings);
        }
        loadDataModules();
        loadBackupsSelect();
        showDataOpStatus(`✅ 已导入 ${(resp.imported || []).length} 个模块，请重新加载相关页面生效`);
      } else {
        showDataOpStatus('导入失败: ' + (resp ? resp.error : '未知错误'), true);
      }
    } catch (err) {
      showDataOpStatus('导入失败: ' + String(err), true);
    }
    e.target.value = '';
  }

  // 创建备份（所选模块）
  async function createDataBackup() {
    const keys = getSelectedModuleKeys();
    if (keys.length === 0) {
      alert('请先勾选要备份的数据类型');
      return;
    }
    const resp = await chrome.runtime.sendMessage({ action: 'CREATE_BACKUP', moduleKeys: keys });
    if (resp && resp.success) {
      showDataOpStatus('✅ 备份成功 (' + keys.length + ' 个模块)');
      loadBackupsSelect();
    } else {
      showDataOpStatus('备份失败', true);
    }
  }

  // 加载备份列表到恢复下拉框
  async function loadBackupsSelect() {
    const select = document.getElementById('restoreBackupSelect');
    const btn = document.getElementById('restoreBackupBtn');
    if (!select) return;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'GET_BACKUPS' });
      const backups = (resp && resp.backups) || [];
      select.innerHTML =
        '<option value="">选择备份...</option>' +
        backups
          .map((b) => {
            const time = new Date(b.timestamp).toLocaleString('zh-CN');
            const modCount = b.modules ? b.modules.length : '全部';
            return `<option value="${escapeAttr(b.id)}">${b.manual ? '🔧' : '⏰'} ${time} (${modCount} 模块)</option>`;
          })
          .join('');
      btn.disabled = backups.length === 0;
    } catch {
      select.innerHTML = '<option value="">备份加载失败</option>';
    }
  }

  // 恢复所选模块
  async function restoreDataBackup() {
    const backupId = document.getElementById('restoreBackupSelect').value;
    if (!backupId) {
      alert('请先选择要恢复的备份');
      return;
    }
    const keys = getSelectedModuleKeys();
    if (keys.length === 0) {
      alert('请先勾选要恢复的数据类型');
      return;
    }
    if (!confirm('恢复将覆盖当前所选模块的数据（系统会先自动备份当前状态）。确定继续？')) return;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'RESTORE_BACKUP', backupId, moduleKeys: keys });
      if (resp && resp.success) {
        const sr = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
        if (sr && sr.settings) {
          OPTS.currentSettings = sr.settings;
          OPTS.renderSettings(OPTS.currentSettings);
        }
        loadDataModules();
        showDataOpStatus('✅ 恢复成功，请重新加载相关页面生效');
      } else {
        showDataOpStatus('恢复失败: ' + (resp ? resp.error : '未知错误'), true);
      }
    } catch (e) {
      showDataOpStatus('恢复失败: ' + String(e), true);
    }
  }

  // 清除所有学习数据
  async function clearData() {
    if (confirm('确定要清除所有学习数据吗？此操作不可恢复。')) {
      await chrome.runtime.sendMessage({ action: 'CLEAR_DATA' });
      alert('学习数据已清除');
    }
  }

  // 恢复默认设置（仅设置项，不影响运行时数据）
  async function resetDefaults() {
    if (!confirm('确定要将所有设置恢复为默认值吗？\n（浏览历史和游戏画像等数据不会被清除）')) return;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'RESET_SETTINGS' });
      if (resp && resp.settings) {
        OPTS.currentSettings = resp.settings;
        OPTS.renderSettings(OPTS.currentSettings);
        OPTS.showSaveStatus('saved');
      } else {
        alert('恢复默认设置失败，请重试。');
      }
    } catch (e) {
      alert('恢复默认设置失败: ' + String(e));
    }
  }

  // 全选/全不选模块 / Select all / none
  function moduleCheckAll() {
    selectedModules = new Set(dataModules.map((m) => m.key));
    renderModuleChecks();
  }
  function moduleCheckNone() {
    selectedModules.clear();
    renderModuleChecks();
  }

  OPTS.loadDataModules = loadDataModules;
  OPTS.loadBackupsSelect = loadBackupsSelect;
  OPTS.exportData = exportData;
  OPTS.importData = importData;
  OPTS.createDataBackup = createDataBackup;
  OPTS.restoreDataBackup = restoreDataBackup;
  OPTS.clearData = clearData;
  OPTS.resetDefaults = resetDefaults;
  OPTS.getSelectedModuleKeys = getSelectedModuleKeys;
  OPTS.moduleCheckAll = moduleCheckAll;
  OPTS.moduleCheckNone = moduleCheckNone;
})(typeof globalThis !== 'undefined' ? globalThis : this);
