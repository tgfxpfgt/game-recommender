/**
 * 游戏雷达 Game Radar - Dashboard 状态区块 Preact 组件（阶段 3 切片 C + 渐进迁移）
 *
 * no-data/错误分支 + 纯数据渲染面（下载方式/站点 Top/游戏明细表/行为日志表）
 * 全部迁组件——Preact 文本插值天然转义（原 innerHTML 拼接的 escapeHtml 防线由
 * 插值语义接管）。趋势图 SVG 保留原实现（computed paths 自包含，diff 收益低）。
 * Preact components for dashboard status blocks AND pure data renders (tables,
 * method/site lists). Trend SVG chart stays as-is (computed paths, low value).
 */
import { h, render } from 'preact';

/** @param {{msg: string}} props */
export function NoData({ msg }) {
  return h('div', { class: 'no-data' }, msg);
}

/** @param {{msg: string}} props */
export function LoadError({ msg }) {
  return h('div', { class: 'no-data' }, msg);
}

/**
 * 下载方式分布（method-item：count 在前 name 在后——与既有 CSS 类序一致）
 * @param {{entries: Array<[string, number]>, methodNames: Record<string, string>}} props
 */
export function DownloadMethods({ entries, methodNames }) {
  return h(
    'div',
    null,
    entries.map(([method, count]) =>
      h(
        'div',
        { class: 'method-item', key: method },
        h('div', { class: 'method-count' }, String(count)),
        h('div', { class: 'method-name' }, methodNames[method] || method)
      )
    )
  );
}

/**
 * 按站点 Top5（同 method-item 形状）
 * @param {{top: Array<[string, number]>}} props
 */
export function SitesTop({ top }) {
  return h(
    'div',
    null,
    top.map(([host, count]) =>
      h(
        'div',
        { class: 'method-item', key: host },
        h('div', { class: 'method-count' }, String(count)),
        h('div', { class: 'method-name' }, host)
      )
    )
  );
}

/**
 * 游戏明细表行（6 列：名称/浏览/下载/标签/评分/最近查看；Preact 插值天然
 * 转义——原 innerHTML 拼接的 escapeHtml 防线由插值语义接管）
 * @param {{games: any[], safeDateText: (ts: number) => string}} props
 */
export function GameTableBody({ games, safeDateText }) {
  return h(
    'tbody',
    null,
    games.map((game, i) => {
      const tags = (game.keywords || []).slice(0, 4);
      const rating = game.steamRating ? game.steamRating + '/10' : '-';
      const time = safeDateText(game.lastSeen);
      const dlClass = game.downloads > 0 ? 'downloaded' : '';
      return h(
        'tr',
        { key: String(game.name) + '-' + String(i) },
        h('td', null, game.name),
        h('td', null, game.views ?? '-'),
        h('td', { class: dlClass }, game.downloads > 0 ? '⬇ ' + game.downloads : '0'),
        h('td', null, tags.length > 0 ? tags.map((t, j) => h('span', { class: 'tag-small', key: String(j) }, t)) : '-'),
        h('td', null, rating),
        h('td', null, time)
      );
    })
  );
}

/** 日志类型展示映射（渲染面数据——原 renderLogTable 内联表迁移） */
export const LOG_TYPE_NAMES = {
  view_list: ['浏览列表', 'list'],
  view_detail: ['查看详情', 'view'],
  click_detail: ['点击详情', 'view'],
  click_download: ['下载游戏', 'download'],
  steam_tags_update: ['Steam标签', 'steam']
};

/**
 * 行为日志表行（5 列：时间/类型/游戏/方式/域名）
 * @param {{logs: any[]}} props
 */
export function LogTableBody({ logs }) {
  return h(
    'tbody',
    null,
    logs.map((log, i) => {
      const known = LOG_TYPE_NAMES[log.type];
      const typeName = known ? known[0] : String(log.type || '未知');
      const typeClass = known ? known[1] : 'list';
      const time = log.timestamp
        ? new Date(log.timestamp).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          })
        : '-';
      return h(
        'tr',
        { key: String(i) },
        h('td', null, time),
        h('td', null, h('span', { class: 'event-type ' + typeClass }, typeName)),
        h('td', null, log.gameName || '-'),
        h('td', null, log.method || '-'),
        h('td', null, log.domain || '-')
      );
    })
  );
}

/**
 * 结构化挂载辅助：render(vnode, mountEl) 位置参数版（classic 侧经 m.mountAt 调用）
 * @param {any} vnode @param {HTMLElement} mountEl
 */
export function mountAt(vnode, mountEl) {
  render(vnode, mountEl);
}

// v14.33.1：classic 侧（dash-stats.js ensurePreactMount）经 m.h 取 preact 的 h
// 构建 TableNoData 虚拟节点——本模块此前漏导出 h（v15 阶段 3 遗留：dashboard
// 空态场景 preactH is not a function，E2E dist 验收暴露）。re-export 修复。
export { h };
