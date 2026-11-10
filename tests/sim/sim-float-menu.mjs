import { expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 内容脚本模拟：浮窗菜单/折叠/调宽（v14.23.0）
 *
 * 轻量套件：直接 import content/core/floats.js（零依赖模块），经 sim-harness
 * 的 FakeEl DOM + 真实化 storage.local 驱动。覆盖：
 *   F1 折叠切换回归（v10.6.0 取反回归——点击恒无操作；修复后菜单项往返）
 *   F2 默认折叠（opts.folded）与展开
 *   F3 折叠状态持久化（grFloatFolded 恢复）
 *   F4 右缘拖拽调宽 + 钳位 + 持久化（grFloatWidth）
 *   F5 缩放步进/钳位/持久化（grFloatScale）
 *   F6 菜单缓存信息区（opts.menuInfo 成功/失败/缺省三态）
 *   F7 菜单外点关闭 + 菜单按钮再点关闭
 *   F8 位置恢复视口钳位（旧坐标出屏防护）
 *   F9 重置项：位置/宽度/缩放回默认 + 存储键清除
 *   F10 remove() 清理文档级监听（菜单外点关闭监听不泄漏）
 *   F11 浮窗专属菜单项（v14.24.0：menuItems 注入/标记/点击/busy 反馈）
 * Light suite: imports floats.js directly (zero-dependency module) and drives
 * it via the harness FakeEl DOM + the now-real storage.local. Covers the fold
 * regression fix, menu items, width drag, zoom persistence, cache info rows,
 * outside-close, restore clamps, reset, and teardown.
 */
('use strict');

import {
  simTest,
  documentMock,
  chromeLocalStore,
  fireDocEvent,
  docListenerCount,
  waitForSignal
} from './sim-harness.mjs';
import { create, closeAll, remove, ZONE } from '../../content/core/floats.js';

const TICK = () => new Promise((r) => setTimeout(r, 0));

// 浮窗结构定位（floats.js 闭包引用元素，不暴露——按插入序取子元素）
// Locate chrome internals by child order (floats.js keeps closure refs).
function chromeParts(body) {
  const root = body.parentNode;
  const header = root.children[0];
  const menu = root.children[2];
  const resize = root.children[3];
  const menuBtn = header.children[1];
  const closeBtn = header.children[2];
  return { root, header, menu, resize, menuBtn, closeBtn };
}
function openMenu(parts) {
  parts.menuBtn.click();
}
const foldItemOf = (menu) => menu.children[0];
const scaleValOf = (menu) => menu.children[1].children[2];
const scaleDownOf = (menu) => menu.children[1].children[1];
const scaleUpOf = (menu) => menu.children[1].children[3];
const resetItemOf = (menu) => menu.children[2];
const menuInfoOf = (menu) => menu.children[4];

// F1. 折叠切换回归——v10.6.0 起 setFolded(当前态) 恒无操作（真机复现）；
// 修复后：菜单项点击必须真实往返（此测试在旧代码下必红）
simTest('F1. 折叠往返：菜单项折叠→展开（v10.6.0 取反回归修复）', async () => {
  closeAll();
  const body = create(ZONE.TOP_LEFT, 'f-fold', { chrome: true, width: 320 });
  const parts = chromeParts(body);
  expect(body.style.display || '').toEqual(''); // 初始展开（FakeEl style 无内联值 = undefined）
  openMenu(parts);
  expect(foldItemOf(parts.menu).textContent).toEqual('折叠浮窗');
  foldItemOf(parts.menu).click();
  expect(body.style.display).toEqual('none'); // 真实折叠（旧代码恒 ''）
  expect(foldItemOf(parts.menu).textContent).toEqual('展开浮窗');
  expect(chromeLocalStore['grFloatFolded:f-fold']).toEqual(true); // 状态记忆写入
  openMenu(parts);
  foldItemOf(parts.menu).click();
  expect(body.style.display || '').toEqual(''); // 再点展开
  expect(chromeLocalStore['grFloatFolded:f-fold']).toEqual(false);
});

// F2. 默认折叠（settings.detailFloatExpanded=false → opts.folded）
simTest('F2. 默认折叠创建（opts.folded）与菜单展开', async () => {
  closeAll();
  const body = create(ZONE.TOP_LEFT, 'f-fold2', { chrome: true, folded: true });
  const parts = chromeParts(body);
  expect(body.style.display).toEqual('none');
  openMenu(parts);
  expect(foldItemOf(parts.menu).textContent).toEqual('展开浮窗');
  foldItemOf(parts.menu).click();
  expect(body.style.display).toEqual('');
});

// F3. 折叠状态持久化恢复（v10.6.0 foldKey 语义保持）
simTest('F3. 折叠状态恢复（grFloatFolded）', async () => {
  closeAll();
  chromeLocalStore['grFloatFolded:f-fold3'] = true;
  const body = create(ZONE.TOP_LEFT, 'f-fold3', { chrome: true });
  await waitForSignal(() => body.style.display === 'none', 'F3: 折叠状态恢复');
  expect(chromeParts(body).menuBtn.textContent).toEqual('⚙'); // 菜单按钮就位
});

// F4. 右缘拖拽调宽：拖动生效 + 上限/下限钳位 + grFloatWidth 持久化
simTest('F4. 拖拽调宽 + 钳位 + 持久化', async () => {
  closeAll();
  const body = create(ZONE.TOP_LEFT, 'f-width', { chrome: true, width: 320 });
  const parts = chromeParts(body);
  const fire = (el, type, ev) =>
    (el._listeners[type] || []).forEach((cb) => cb({ preventDefault() {}, stopPropagation() {}, ...ev }));
  // +60px → 380
  fire(parts.resize, 'mousedown', { clientX: 100 });
  fireDocEvent('mousemove', { clientX: 160 });
  fireDocEvent('mouseup', {});
  expect(parts.root.style.width).toEqual('380px');
  expect(chromeLocalStore['grFloatWidth:f-width']).toEqual(380);
  // 上限钳位：拖到视口外 → FLOAT_WIDTH_MAX 640（innerWidth 1400，左缘 0）
  fire(parts.resize, 'mousedown', { clientX: 160 });
  fireDocEvent('mousemove', { clientX: 5000 });
  fireDocEvent('mouseup', {});
  expect(parts.root.style.width).toEqual('640px');
  // 下限钳位：左拖远超 → 260
  fire(parts.resize, 'mousedown', { clientX: 100 });
  fireDocEvent('mousemove', { clientX: -5000 });
  fireDocEvent('mouseup', {});
  expect(parts.root.style.width).toEqual('260px');
  // 恢复：存储宽度在 create 时应用
  chromeLocalStore['grFloatWidth:f-widthr'] = 500;
  const body2 = create(ZONE.TOP_LEFT, 'f-widthr', { chrome: true, width: 320 });
  await waitForSignal(() => body2.parentNode.style.width === '500px', 'F4: 宽度恢复');
});

// F5. 缩放：步进 ±10%、[80%,140%] 钳位、grFloatScale 持久化与恢复
simTest('F5. 缩放步进/钳位/持久化', async () => {
  closeAll();
  const body = create(ZONE.TOP_LEFT, 'f-scale', { chrome: true });
  const parts = chromeParts(body);
  openMenu(parts);
  expect(scaleValOf(parts.menu).textContent).toEqual('100%');
  scaleUpOf(parts.menu).click();
  expect(body.style.zoom).toEqual('1.1');
  expect(scaleValOf(parts.menu).textContent).toEqual('110%');
  expect(chromeLocalStore['grFloatScale:f-scale']).toEqual(1.1);
  // 上限钳位：连点到 140% 后不再增大
  for (let i = 0; i < 5; i++) scaleUpOf(parts.menu).click();
  expect(scaleValOf(parts.menu).textContent).toEqual('140%');
  expect(body.style.zoom).toEqual('1.4');
  // 下限钳位：连点到 80% 后不再缩小
  for (let i = 0; i < 10; i++) scaleDownOf(parts.menu).click();
  expect(scaleValOf(parts.menu).textContent).toEqual('80%');
  // 恢复 + 非法值忽略
  chromeLocalStore['grFloatScale:f-scaler'] = 1.3;
  const body2 = create(ZONE.TOP_LEFT, 'f-scaler', { chrome: true });
  await waitForSignal(() => body2.style.zoom === '1.3', 'F5: 缩放恢复');
  chromeLocalStore['grFloatScale:f-scalebad'] = 9;
  const body3 = create(ZONE.TOP_LEFT, 'f-scalebad', { chrome: true });
  await TICK();
  expect(body3.style.zoom).toEqual(undefined); // 越界值不应用（保持默认）
});

// F6. 菜单缓存信息区：provider 成功两行 / 抛错降级 / 未提供隐藏
simTest('F6. 菜单缓存信息区三态', async () => {
  closeAll();
  // 成功：行渲染（textContent 注入——天然转义）
  const body = create(ZONE.TOP_LEFT, 'f-info', {
    chrome: true,
    menuInfo: async () => ['本游戏缓存：5 分钟前', 'Steam 缓存：12 条（命中 9 / 未中 3）']
  });
  const parts = chromeParts(body);
  openMenu(parts);
  const info = menuInfoOf(parts.menu);
  await waitForSignal(() => info.children.length === 2, 'F6: 缓存信息行渲染');
  expect(info.children[0].textContent).toEqual('本游戏缓存：5 分钟前');
  // 抛错：降级提示
  const body2 = create(ZONE.TOP_LEFT, 'f-info-bad', {
    chrome: true,
    menuInfo: async () => {
      throw new Error('boom');
    }
  });
  const parts2 = chromeParts(body2);
  openMenu(parts2);
  await waitForSignal(() => menuInfoOf(parts2.menu).textContent === '缓存信息不可用', 'F6: 失败降级');
  // 未提供：分隔线与信息区隐藏
  const body3 = create(ZONE.TOP_LEFT, 'f-info-none', { chrome: true });
  const parts3 = chromeParts(body3);
  openMenu(parts3);
  await TICK();
  expect(menuInfoOf(parts3.menu).style.display).toEqual('none');
  expect(parts3.menu.children[3].style.display).toEqual('none'); // menuSep
});

// F7. 菜单开合：外点关闭、菜单内按下不关、菜单按钮再点关闭
simTest('F7. 菜单外点关闭语义', async () => {
  closeAll();
  const body = create(ZONE.TOP_LEFT, 'f-menu-close', { chrome: true });
  const parts = chromeParts(body);
  openMenu(parts);
  expect(parts.menu.style.display).toEqual('');
  // 页面其他位置按下 → 关闭
  fireDocEvent('mousedown', { target: documentMock.body });
  expect(parts.menu.style.display).toEqual('none');
  // 再开：菜单按钮自身按下不关闭（交给 click 语义）
  openMenu(parts);
  fireDocEvent('mousedown', { target: parts.menuBtn });
  expect(parts.menu.style.display).toEqual('');
  parts.menuBtn.click(); // 再点 → 关闭
  expect(parts.menu.style.display).toEqual('none');
  // 菜单内部按下（菜单项所在层级）不触发外点关闭
  openMenu(parts);
  fireDocEvent('mousedown', { target: foldItemOf(parts.menu) });
  expect(parts.menu.style.display).toEqual('');
});

// F8. 位置恢复视口钳位（v14.23.0：换屏/缩窗后旧坐标出屏防护）
simTest('F8. 位置恢复视口钳位', async () => {
  closeAll();
  chromeLocalStore['grFloatPos:f-pos'] = { left: 99999, top: 99999 };
  const body = create(ZONE.TOP_LEFT, 'f-pos', { chrome: true });
  await waitForSignal(() => body.parentNode.style.left === '1340px', 'F8: 出屏坐标钳位（innerWidth-60）');
  expect(body.parentNode.style.top).toEqual('870px'); // innerHeight-30
  // 负坐标钳位到 0
  chromeLocalStore['grFloatPos:f-pos2'] = { left: -50, top: -50 };
  const body2 = create(ZONE.TOP_LEFT, 'f-pos2', { chrome: true });
  await waitForSignal(() => body2.parentNode.style.left === '0px', 'F8: 负坐标钳位');
});

// F9. 重置项：宽度/缩放/位置回默认 + 三个存储键清除（undefined = 删键）
simTest('F9. 重置位置与大小', async () => {
  closeAll();
  chromeLocalStore['grFloatPos:f-reset'] = { left: 300, top: 300 };
  const body = create(ZONE.TOP_LEFT, 'f-reset', { chrome: true, width: 320 });
  await waitForSignal(() => body.parentNode.style.left === '300px', 'F9: 位置恢复（前置）');
  const parts = chromeParts(body);
  const fire = (el, type, ev) =>
    (el._listeners[type] || []).forEach((cb) => cb({ preventDefault() {}, stopPropagation() {}, ...ev }));
  fire(parts.resize, 'mousedown', { clientX: 0 });
  fireDocEvent('mousemove', { clientX: 100 });
  fireDocEvent('mouseup', {});
  openMenu(parts);
  scaleUpOf(parts.menu).click();
  expect(parts.root.style.width).toEqual('420px');
  resetItemOf(parts.menu).click();
  expect(parts.root.style.width).toEqual('320px'); // 回 opts.width
  expect(body.style.zoom).toEqual('1'); // 缩放回默认
  expect(parts.root.style.left).toEqual('16px'); // 分区基准位
  expect(parts.root.style.top).toEqual('80px');
  expect('grFloatPos:f-reset' in chromeLocalStore).toEqual(false);
  expect('grFloatWidth:f-reset' in chromeLocalStore).toEqual(false);
  expect('grFloatScale:f-reset' in chromeLocalStore).toEqual(false);
});

// F10. remove() 清理：teardown 关闭菜单并自摘外点监听（不泄漏）
simTest('F10. remove 清理文档级监听', async () => {
  closeAll();
  const base = docListenerCount('mousedown');
  const body = create(ZONE.TOP_LEFT, 'f-teardown', { chrome: true });
  const parts = chromeParts(body);
  openMenu(parts); // 注册外点关闭监听
  expect(parts.menu.style.display).toEqual('');
  expect(docListenerCount('mousedown')).toEqual(base + 1);
  remove('f-teardown');
  expect(parts.root.parentNode).toEqual(null); // 浮窗已脱文档
  expect(parts.menu.style.display).toEqual('none'); // teardown 关闭菜单
  expect(docListenerCount('mousedown')).toEqual(base); // 外点监听已自摘（无泄漏）
  fireDocEvent('mousedown', { target: documentMock.body }); // 不抛 = 状态自洽
});

// F11. 浮窗专属菜单项（v14.24.0：手动更新/重新检索/选择机型迁入 ⚙ 菜单）——
// 渲染位置（重置项后、分隔线前）+ data-menu-action 标记 + 点击执行 + busy
// 文案自管（菜单保持打开，多秒动作的进度在菜单内可见）
simTest('F11. 浮窗专属菜单项（menuItems 注入 + 点击 + busy 反馈）', async () => {
  closeAll();
  const calls = [];
  /** @type {(() => void)|null} */
  let resolveAction = null;
  const body = create(ZONE.TOP_LEFT, 'f-items', {
    chrome: true,
    menuItems: [
      {
        action: 'act-a',
        label: '动作 A',
        title: '动作 A 提示',
        onClick: (btn) => {
          calls.push('a');
          btn.textContent = '⏳ A 中...'; // busy 反馈由回调自管（sidebar.js 同款）
          return new Promise((r) => {
            resolveAction = () => {
              btn.textContent = '✅ 完成';
              r();
            };
          });
        }
      },
      { label: '无动作项' } // 无 action —— 纯文案项（不含 data-menu-action）
    ]
  });
  const parts = chromeParts(body);
  openMenu(parts);
  // 结构序：fold/scale/reset 之后插入 menuItems，随后是分隔线与缓存信息区
  const items = parts.menu.children.filter((c) => c.getAttribute('data-menu-action'));
  expect(items.length).toEqual(1);
  expect(items[0].getAttribute('data-menu-action')).toEqual('act-a');
  expect(items[0].textContent).toEqual('动作 A');
  expect(items[0].title).toEqual('动作 A 提示');
  // 位置断言：menuItems 在 reset 与分隔线之间（现有子元素序不被破坏）
  const idx = parts.menu.children.indexOf(items[0]);
  expect(parts.menu.children[idx - 1].textContent).toEqual('重置位置与大小');
  // 点击执行 + busy 文案可见（菜单未关闭）
  items[0].click();
  expect(items[0].textContent).toEqual('⏳ A 中...');
  expect(parts.menu.style.display).toEqual(''); // 菜单保持打开（进度可见）
  resolveAction();
  await TICK();
  expect(items[0].textContent).toEqual('✅ 完成');
  expect(calls).toEqual(['a']);
});
