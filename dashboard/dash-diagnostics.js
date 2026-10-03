/* global paginate renderPager safeDateText toCsv downloadCsv */
/* eslint-disable no-unused-vars */
/**
 * 游戏雷达 Game Radar - Dashboard 诊断模块 / Dashboard Diagnostics Module
 *
 * v14 B1：由 dashboard.js 拆分——出站请求审计（主机/状态/耗时/筛选/导出）、
 * 存储与站点适配器健康卡、Steam API 限流与分域可达性、启动耗时基线、运行指标卡。
 * Split from dashboard.js (B1): outbound request audit, storage/site health
 * cards, Steam API rate-limit & per-domain reachability, boot time, runtime metrics.
 *
 * 依赖（经典脚本跨文件全局作用域，事件/异步回调期调用）：
 * - dash-logs.js：paginate / renderPager（统一分页）
 * - dashboard.js（壳）：safeDateText
 * - dash-export.js：toCsv / downloadCsv（审计 CSV 导出）
 * 共享状态：cachedAudit（本文件定义）。
 */

// ============ 出站请求审计 / Outbound Request Audit ============
let cachedAudit = { entries: [], stats: null };

// 从后台加载出站请求审计（最近 100 条）/ Load outbound request audit (latest 100)
async function loadOutboundAudit() {
  const container = document.getElementById('auditList');
  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'GET_OUTBOUND_AUDIT', limit: 100 });
    cachedAudit = (response && response.audit) || { entries: [], stats: null };
    renderOutboundAudit();
  } catch (e) {
    container.innerHTML = `<div class="no-data">加载审计失败: ${escapeHtml(window.__GR_MSG__.toUserMessage(e))}</div>`;
  }
}

// 渲染审计列表（最新在前，失败高亮；v4.1.0：支持主机筛选）
// Render audit (newest first, failures red; host filter since v4.1.0)
function renderOutboundAudit() {
  const container = document.getElementById('auditList');
  const stats = cachedAudit.stats || {};
  const statsEl = document.getElementById('auditStats');
  statsEl.textContent = stats.total > 0 ? `共 ${stats.total} 次 · 失败 ${stats.failed}（${stats.failRate}%）` : '';
  const filter = (document.getElementById('auditHostFilter').value || '').trim().toLowerCase();
  const entries = (cachedAudit.entries || []).filter((e) => !filter || (e.host || '').toLowerCase().includes(filter));
  if (entries.length === 0) {
    container.innerHTML = '<div class="no-data">' + (filter ? '无匹配主机记录' : '暂无请求记录') + '</div>';
    renderPager('audit', 'auditPager', 0);
    return;
  }
  const { slice: auditSlice, total: auditTotal } = paginate('audit', entries);
  renderPager('audit', 'auditPager', auditTotal);
  container.innerHTML = auditSlice
    .map((e) => {
      const time = safeDateText(e.t, {
        // v10.9.1
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const detail = e.status ? `HTTP ${e.status}` : e.ok ? '成功' : '异常';
      return `<div class="log-entry ${e.ok ? '' : 'log-error'}">
      <span class="log-time">${time}</span>
      <span class="log-module">[${escapeHtml(e.host)}]</span>
      <span class="log-msg">${e.ok ? '✓' : '✗'} ${escapeHtml(detail)} · ${e.ms}ms</span>
    </div>`;
    })
    .join('');
}

// v4.1.0：导出审计 CSV（含筛选结果）/ Export the (filtered) audit as CSV
function exportAuditCsv() {
  const filter = (document.getElementById('auditHostFilter').value || '').trim().toLowerCase();
  const entries = (cachedAudit.entries || []).filter((e) => !filter || (e.host || '').toLowerCase().includes(filter));
  if (entries.length === 0) {
    alert('暂无审计记录');
    return;
  }
  downloadCsv(
    `game-recommender-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(
      ['时间', '主机', '成功', '状态', '耗时ms'],
      entries.map((e) => [new Date(e.t).toLocaleString('zh-CN'), e.host, e.ok ? '是' : '否', e.status || '', e.ms])
    )
  );
}

// 清空出站请求审计 / Clear outbound request audit
async function clearAudit() {
  if (!confirm('确定要清空出站请求审计吗？')) return;
  await window.__GR_MSG__.sendMessage({ action: 'CLEAR_OUTBOUND_AUDIT' });
  loadOutboundAudit();
}

// v10.0.0：存储健康 + 站点适配器健康（诊断卡与明细列表）
async function loadHealthCards() {
  try {
    const storageHealth = await window.__GR_MSG__.sendMessage({ action: 'GET_STORAGE_HEALTH' });
    const opfsEl = document.getElementById('diagOpfsMode');
    const failEl = document.getElementById('diagFlushFails');
    if (opfsEl) {
      opfsEl.textContent = storageHealth && storageHealth.opfsAvailable ? 'OPFS' : '降级 local';
      opfsEl.title =
        storageHealth && storageHealth.opfsAvailable
          ? '数据存储于 OPFS（每模块独立文件）'
          : 'OPFS 不可用，已降级 chrome.storage.local（受 5MB 配额限制）';
    }
    if (failEl) {
      const fails =
        ((storageHealth && storageHealth.steamCacheWriteFails) || 0) +
        ((storageHealth && storageHealth.registryWriteFails) || 0) +
        ((storageHealth && storageHealth.nameIndexWriteFails) || 0) +
        ((storageHealth && storageHealth.urlIndexWriteFails) || 0);
      failEl.textContent = String(fails);
      failEl.title =
        storageHealth && storageHealth.lastFailModule
          ? `最近失败模块: ${storageHealth.lastFailModule}（写失败会自动回滚重试）`
          : '本次会话无写失败（失败会自动回滚重试）';
    }
  } catch {
    /* 存储健康读取失败忽略 */
  }
  try {
    const siteHealth = await window.__GR_MSG__.sendMessage({ action: 'GET_SITE_HEALTH' });
    const alertEl = document.getElementById('diagSiteAlerts');
    const sites = (siteHealth && siteHealth.sites) || [];
    const totalAlerts = sites.reduce((sum, s) => sum + (s.alertCount || 0), 0);
    if (alertEl) {
      alertEl.textContent = String(totalAlerts);
      alertEl.title =
        sites.length > 0 ? sites.map((s) => `${s.siteKey}: ${s.alertCount ?? 0} 次`).join('\n') : '无告警记录';
    }
    // 明细列表（仅存在告警时显示）/ per-site detail when alerts exist
    const listEl = document.getElementById('siteHealthList');
    if (listEl) {
      if (sites.length === 0) {
        listEl.style.display = 'none';
        listEl.innerHTML = '';
      } else {
        listEl.style.display = 'block';
        listEl.innerHTML =
          '<div style="color:#e74c3c;">⚠ 站点适配器疑似失效（列表项提取为 0，请检查/更新适配规则）：</div>' +
          sites
            .map(
              (s) =>
                `<div style="margin-top:2px;">• ${escapeHtml(s.siteKey)}（${escapeHtml(s.host || '?')}）— ` +
                `${s.alertCount} 次，最近 ${new Date(s.lastAlertAt || Date.now()).toLocaleString()}</div>`
            )
            .join('');
      }
    }
  } catch {
    /* 站点健康读取失败忽略 */
  }
}

// v7.1.0：Steam API 限流状态诊断（自助诊断——"为什么数据没更新"）
async function loadApiDiagnostics() {
  const el = document.getElementById('diagApiStatus');
  if (!el) return;
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_API_STATUS' });
    if (!resp) {
      el.textContent = '—';
      return;
    }
    const dm = resp.domains || {};
    const el2 = document.getElementById('diagDomainStatus');
    if (el2) {
      const lamp = (v) => (v === 'ok' ? '🟢' : v === 'down' ? '🔴' : '⚪');
      el2.textContent = `商店 ${lamp(dm.store)} / API ${lamp(dm.api)}`;
      el2.title = dm.circuit === 'open' ? '熔断中：连续网络失败，60s 后自动重试' : '分域名可达性（最近请求滚动窗口）';
    }
    if (resp.anomaly) {
      el.textContent = `⚠️ 异常（${resp.failRate}%）`;
      el.style.color = '#e5534b';
      el.title = `近 ${resp.windowSec / 60} 分钟失败 ${resp.failed}/${resp.total} 次，疑似限流`;
    } else if (resp.total < 8) {
      el.textContent = `采样中（${resp.total}）`;
      el.style.color = '#f0a93b';
      el.title = '调用量不足，状态待定';
    } else {
      el.textContent = `✅ 正常（${resp.failRate}%）`;
      el.style.color = '#a3cf06';
      el.title = `近 ${resp.windowSec / 60} 分钟 ${resp.total} 次调用，失败 ${resp.failed} 次`;
    }
  } catch {
    el.textContent = '—';
  }
}

// v9.1.0：性能基线（从 runtimeLog 读最近 Perf 条目——启动耗时）
async function loadBootTime() {
  const el = document.getElementById('diagBootTime');
  if (!el) return;
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_RUNTIME_LOGS', limit: 200 });
    const logs = (resp && resp.logs) || [];
    const perf = logs.filter((l) => l && l.module === 'Perf');
    if (perf.length === 0) {
      el.textContent = '—';
      return;
    }
    const latest = perf[perf.length - 1];
    const m = String(latest.message || '').match(/(\d+)ms/);
    el.textContent = m ? m[1] + 'ms' : '—';
    el.title = `${latest.message} · ${safeDateText(latest.ts || latest.timestamp, { dateStyle: 'short', timeStyle: 'medium' })}`; // v10.9.1
  } catch {
    el.textContent = '—';
  }
}

// v10.7.0 批次5：运行指标（评分批次 P95 / OPFS 写次数 / 消息总数）
// Runtime metrics cards (quantified benefits of the write-amplification work).
async function loadRuntimeMetrics() {
  const batchEl = document.getElementById('diagBatchMs');
  const opfsEl = document.getElementById('diagOpfsWrites');
  const msgEl = document.getElementById('diagMsgTotal');
  if (!batchEl || !opfsEl || !msgEl) return;
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_RUNTIME_METRICS' });
    const m = resp && resp.metrics;
    if (!m) {
      batchEl.textContent = opfsEl.textContent = msgEl.textContent = '—';
      return;
    }
    const batch = m.hist && m.hist['batch.ms'];
    batchEl.textContent = batch ? String(batch.p95) : '—';
    batchEl.title = batch ? `样本 ${batch.count} · 平均 ${batch.avg} ms` : '暂无批次样本';
    const counters = m.counters || {};
    const opfsWrites = Object.entries(counters)
      .filter(([k]) => k.startsWith('opfs.writeCount.'))
      .reduce((acc, [, v]) => acc + (Number(v) || 0), 0); // v10.9：session 恢复异型防拼接
    opfsEl.textContent = String(opfsWrites);
    const opfsBytes = Object.entries(counters)
      .filter(([k]) => k.startsWith('opfs.writeBytes.'))
      .reduce((acc, [, v]) => acc + (Number(v) || 0), 0); // v10.9：session 恢复异型防拼接
    opfsEl.title = opfsBytes > 0 ? `累计 ${(opfsBytes / 1024 / 1024).toFixed(2)} MB` : '';
    const msgTotal = Object.entries(counters)
      .filter(([k]) => k.startsWith('msg.'))
      .reduce((acc, [, v]) => acc + (Number(v) || 0), 0); // v10.9：session 恢复异型防拼接
    msgEl.textContent = String(msgTotal);
  } catch {
    batchEl.textContent = opfsEl.textContent = msgEl.textContent = '—';
  }
}
