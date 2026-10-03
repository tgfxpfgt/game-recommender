/* global safeDateText */
/* eslint-disable no-unused-vars */
/**
 * 游戏雷达 Game Radar - Dashboard 备份模块 / Dashboard Backups Module
 *
 * v14 B1：由 dashboard.js 拆分——备份列表渲染与创建/恢复/删除操作。
 * Split from dashboard.js (B1): backup list rendering and create/restore/delete.
 *
 * 依赖（经典脚本跨文件全局作用域，事件/异步回调期调用）：
 * - dashboard.js（壳）：safeDateText
 * 本文件无共享状态（备份列表每次请求后即渲染，不缓存）。
 */

// ============ 备份管理 / Backup Management ============
// 加载备份列表并渲染 / Load and render the backup list
async function loadBackups() {
  const container = document.getElementById('backupList');
  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'GET_BACKUPS' });
    const backups = (response && response.backups) || [];

    if (backups.length === 0) {
      container.innerHTML = '<div class="no-data">暂无备份，点击“立即备份”创建</div>';
      return;
    }

    container.innerHTML = backups
      .map((b) => {
        const time = safeDateText(b.timestamp); // v10.9.1
        const sizeKb = b.size ? (b.size / 1024).toFixed(1) : '?';
        const modInfo = b.modules ? ` · ${b.modules.length} 模块` : ' · 全部模块';
        return `<div class="backup-item">
        <div class="backup-info">
          <span class="backup-type">${b.manual ? '🔧 手动' : '⏰ 自动'}</span>
          <span class="backup-time">${time}</span>
          <span class="backup-size">${sizeKb} KB${modInfo}</span>
        </div>
        <div class="backup-actions">
          <button class="btn btn-sm backup-restore-btn" data-id="${escapeAttr(b.id)}">♻️ 恢复</button>
          <button class="btn btn-sm btn-danger backup-delete-btn" data-id="${escapeAttr(b.id)}">删除</button>
        </div>
      </div>`;
      })
      .join('');

    // 绑定恢复/删除按钮（内联 onclick 在 MV3 扩展页被 CSP 禁止，必须用 addEventListener）
    // Bind restore/delete buttons (inline onclick is blocked by MV3 extension-page CSP)
    container.querySelectorAll('.backup-restore-btn').forEach((btn) => {
      btn.addEventListener('click', () => restoreBackup(btn.dataset.id));
    });
    container.querySelectorAll('.backup-delete-btn').forEach((btn) => {
      btn.addEventListener('click', () => deleteBackup(btn.dataset.id));
    });
  } catch (e) {
    container.innerHTML = `<div class="no-data">加载备份失败: ${escapeHtml(window.__GR_MSG__.toUserMessage(e))}</div>`;
  }
}

// 创建备份 / Create a backup
async function createBackup() {
  const statusEl = document.getElementById('backupStatus');
  statusEl.textContent = '备份中...';
  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'CREATE_BACKUP' });
    if (response && response.success) {
      statusEl.textContent = '✅ 备份成功';
      loadBackups();
    } else {
      statusEl.textContent = '❌ 备份失败';
    }
  } catch (e) {
    statusEl.textContent = '❌ ' + window.__GR_MSG__.toUserMessage(e);
  }
  setTimeout(() => {
    statusEl.textContent = '';
  }, 3000);
}

// 恢复备份（后台会先自动备份当前状态作为安全网）
// Restore a backup (background creates a safety-net backup of the current state first)
async function restoreBackup(id) {
  if (!confirm('恢复备份将覆盖当前数据（系统会先自动备份当前状态）。确定继续？')) return;
  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'RESTORE_BACKUP', backupId: id });
    if (response && response.success) {
      alert('✅ 恢复成功，页面将刷新');
      location.reload();
    } else {
      alert('❌ 恢复失败: ' + (response ? response.error : '未知错误'));
    }
  } catch (e) {
    alert('❌ 恢复失败: ' + window.__GR_MSG__.toUserMessage(e));
  }
}

// 删除备份 / Delete a backup
async function deleteBackup(id) {
  if (!confirm('确定删除该备份？')) return;
  await window.__GR_MSG__.sendMessage({ action: 'DELETE_BACKUP', backupId: id });
  loadBackups();
}
