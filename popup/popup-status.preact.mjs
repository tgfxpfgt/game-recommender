/**
 * 游戏雷达 Game Radar - Popup 状态区 Preact 组件（阶段 3 切片 B 首件）
 *
 * loadApiStatus 的 innerHTML 拼接 → 声明式组件（渲染由 preact diff 完成，
 * escapeHtml 语义由文本插值天然保证）。数据采集仍走消息层，本文件只管视图。
 * Preact component for the popup status block: declarative rendering replaces
 * innerHTML concat; data still arrives via the message layer.
 */
import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

/** 异型响应数值守卫 / guard any-shaped numeric fields */
const num = (/** @type {any} */ v) => Number(v) || 0;

/**
 * @param {{domains?: Record<string, any>, anomaly?: boolean, windowSec?: number, total?: number, failed?: number, failRate?: number, limited?: number, sessionTotal?: number, sessionFailed?: number}} resp
 */
function domainLineOf(resp) {
  const dm = resp.domains || {};
  const lamp = (/** @type {string} */ v) => (v === 'ok' ? '🟢' : v === 'down' ? '🔴' : '⚪');
  const circuitHint = (/** @type {any} */ d) =>
    dm[d + 'Circuit'] === 'open' ? ' ⚡熔断中' : dm[d + 'Circuit'] === 'half-open' ? ' ⚡半开探测' : '';
  if (!dm.store && !dm.api) return null;
  return h(
    'div',
    { style: 'font-size:11px;color:var(--gr-tok-steam-text-dim,#8f98a0);margin-top:4px;' },
    `可达性：商店 ${lamp(dm.store)}${circuitHint('store')} / API ${lamp(dm.api)}${circuitHint('api')}`
  );
}

/** @param {{resp: any}} props */
function ApiStatusBody({ resp }) {
  if (!resp) return h('span', { class: 'no-data' }, '无法获取状态');
  const line = domainLineOf(resp);
  if (resp.anomaly) {
    return h(
      'div',
      null,
      h(
        'span',
        { style: 'color:var(--gr-tok-danger,#e74c3c);font-size:12px;' },
        `⚠️ Steam API 异常：近 ${num(resp.windowSec) / 60} 分钟失败率 `,
        h('b', null, `${num(resp.failRate)}%`),
        `（${num(resp.failed)}/${num(resp.total)} 次失败），疑似限流`
      ),
      line,
      h(
        'div',
        { style: 'font-size:11px;color:var(--gr-tok-steam-text-dim,#8f98a0);margin-top:4px;' },
        '扩展已自动降低批量检索速度；建议稍后重试或减少连续刷新'
      )
    );
  }
  if (num(resp.total) < 8) {
    return h(
      'div',
      null,
      h(
        'span',
        { style: 'font-size:12px;color:var(--gr-tok-steam-text-dim,#8f98a0);' },
        `采样中：近 5 分钟 ${num(resp.total)} 次调用（${num(resp.failed)} 次失败）`
      )
    );
  }
  return h(
    'div',
    null,
    h(
      'span',
      { style: 'font-size:12px;color:var(--gr-tok-ok-green,#a3cf06);' },
      `✅ Steam API 正常：近 ${num(resp.windowSec) / 60} 分钟 ${num(resp.total)} 次调用，失败 ${num(resp.failed)} 次（${num(resp.failRate)}%）${num(resp.limited) > 0 ? `，限流 ${num(resp.limited)} 次` : ''}`
    ),
    line,
    num(resp.sessionTotal) > 0
      ? h(
          'div',
          { style: 'font-size:11px;color:var(--gr-tok-steam-text-dim,#8f98a0);margin-top:4px;' },
          `本次浏览器会话已出网 ${num(resp.sessionTotal)} 次 Steam 请求${num(resp.sessionFailed) > 0 ? `（失败 ${num(resp.sessionFailed)}）` : ''}`
        )
      : null
  );
}

/** 挂载点渲染（popup-status.js 调用；dot 类名同步保留旧契约） */
export function renderApiStatus(resp, dotEl, mountEl) {
  if (!resp) {
    dotEl.className = 'status-dot';
  } else if (resp.anomaly) {
    dotEl.className = 'status-dot error';
  } else if (num(resp.total) < 8) {
    dotEl.className = 'status-dot';
  } else {
    dotEl.className = 'status-dot ok';
  }
  render(h(ApiStatusBody, { resp }), mountEl);
}
