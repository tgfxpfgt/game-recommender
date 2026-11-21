/**
 * 游戏雷达 Game Radar - 内容侧 Preact 挂载助手 / Content Preact Mount Helper
 *
 * v15 阶段 3 全量迁移：内容域 innerHTML → Preact h() 渲染的单点入口。
 * 内容模块是 ESM（esbuild bundle 内联 preact ~4KB；源模式 vitest 直解析裸包名），
 * 静态 import 无需登记 module-manifest（清单只登记顶层装载单元——被入口静态
 * import 的内部依赖模块无需登记，见 manifest 头注）。
 * Content modules are ESM (esbuild inlines preact; vitest resolves the bare
 * specifier from source mode). Static import needs no module-manifest entry.
 *
 * 共享容器纪律（本助手存在的理由）：浮窗 panel 容器在多个视图间复用
 *（加载占位 ↔ 手动选择 ↔ Steam 信息 ↔ 错误态），历史上由 innerHTML 整体
 * 替换。实证（2026-11-21 探针）：Preact render 对容器内异源 DOM **追加而非
 * 替换**，render(null) 也只摘除 Preact 自管理节点——混用容器直接 render 会
 * 叠加残留。mountView 以"清记录 + 清场 + 干净挂载"三步保证任意前序视图
 *（Preact 或 innerHTML）之后都得到与全新容器一致的挂载结果。
 * Shared-container discipline: the float panel is reused across views that
 * were historically replaced via innerHTML. Preact render APPENDS to foreign
 * DOM children (probed), so mountView resets the vnode record, clears the
 * container and mounts clean — identical to a fresh container every time.
 */

import { h, render, Fragment } from 'preact';

export { h, render, Fragment };

/**
 * 共享容器安全挂载（幂等）：任意前序视图（Preact 树或 innerHTML 写入）之后
 * 调用都等价于全新容器。render(null) 先摘旧 Preact 记录与自管理节点（已被
 * innerHTML 换掉的节点经 Preact removeNode 的 parentNode 守卫静默跳过），
 * replaceChildren() 清掉异源残留，最后干净挂载。
 * Safe mount on a reused container: reset the Preact record, clear foreign
 * DOM, then mount — equivalent to a fresh container regardless of history.
 * @param {HTMLElement} container - 挂载容器（浮窗 panel / 列表容器等）
 * @param {any} vnode - 组件树（h() 产物）
 */
export function mountView(container, vnode) {
  render(null, container); // 清旧 Preact 记录（无记录时为 no-op）
  // 清异源 DOM（innerHTML 时代的残留形态）——removeChild 循环而非
  // replaceChildren（旧单测 DOM 桩无该方法；同时也是零 sink 写法）
  while (container.firstChild) container.removeChild(container.firstChild);
  render(vnode, container);
}
