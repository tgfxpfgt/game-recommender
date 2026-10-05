/**
 * 游戏雷达 Game Radar - 设置页"每项恢复默认"单测
 *
 * v14.2.0（复审轮 P1-1/P2-1：196 行零测试且在覆盖率逃逸目录）——经 DOM stub
 * 驱动真实 bindResetDefaults → 按钮注入 → 点击委托 → resetOne → renderSettings
 * 单源应用器 → 防抖保存 的完整链路（模块加载无 DOM 副作用，可安全 import）。
 * 同时让该文件进入覆盖率统计（coverage-gate fail-closed 后不再逃逸）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// msg 层桩（GET_DEFAULT_SETTINGS 返回受控基线）
const defaultsFixture = {
  enabled: false,
  highlightThreshold: 0.4,
  weights: { clickRate: 0.2, nested: { a: 1 } },
  badgeVisibility: { score: true, all: true },
  cacheTtls: { registry: { value: 30, unit: 'day' } }
};
globalThis.__GR_MSG__ = {
  sendMessage: vi.fn(async () => ({ defaults: defaultsFixture }))
};
globalThis.window = globalThis; // reset-defaults 经 window.__GR_MSG__ 取消息层（node 无 window）

// 最小 DOM 桩：锚点 → 行（.setting-row）→ 行头（.label-text，按钮挂载点）
const label = {
  children: [],
  appendChild(el) {
    label.children.push(el);
  }
};
const fakeRow = {
  appendChild() {},
  querySelector(sel) {
    return sel === '.label-text' ? label : null;
  },
  __grResetPaths: null
};
function makeAnchor() {
  return {
    closest(sel) {
      return sel === '.setting-row' ? fakeRow : null;
    }
  };
}
const anchors = {};
const createdButtons = [];
let docClickHandler = null;
globalThis.document = {
  body: { dataset: {} },
  getElementById(id) {
    return anchors[id] || null;
  },
  createElement() {
    const btn = {
      type: '',
      className: '',
      dataset: {},
      style: {},
      textContent: '',
      title: '',
      getAttribute(k) {
        // 真实 DOM dataset.path 反射为 data-path 属性——桩做同映射
        if (k === 'data-path') return btn.dataset.path ?? null;
        return btn.dataset[k] ?? null;
      },
      closest(sel) {
        return sel === '.gr-reset-one' ? btn : null;
      }
    };
    createdButtons.push(btn);
    return btn;
  },
  addEventListener(_evt, handler) {
    docClickHandler = handler; // 捕获委托，测试直接驱动
  }
};

const OPTS = (globalThis.__OPTS__ = globalThis.__OPTS__ || {});
OPTS.currentSettings = {
  enabled: true,
  highlightThreshold: 0.9,
  weights: { clickRate: 0.8, nested: { a: 9 } },
  badgeVisibility: { score: false, all: false },
  cacheTtls: { registry: { value: 1, unit: 'hour' } }
};
OPTS.renderSettings = vi.fn();
OPTS.scheduleAutoSave = vi.fn();
OPTS.TTL_FIELDS = [{ id: 'ttlRegistry', key: 'registry' }];
anchors.ttlRegistry = makeAnchor();
anchors.enabled = makeAnchor();
anchors.threshold = makeAnchor();
anchors.weightClick = makeAnchor();

await import('../../options/panels/reset-defaults.js');
const { bindResetDefaults } = OPTS;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bindResetDefaults（按钮注入，幂等）', () => {
  it('为锚点行注入 ↺ 按钮（含 TTL 动态字段），重复绑定不重复注入', () => {
    bindResetDefaults();
    const count1 = label.children.length;
    expect(count1).toBeGreaterThanOrEqual(4); // enabled/threshold/weightClick/ttlRegistry
    bindResetDefaults(); // 幂等
    expect(label.children.length).toEqual(count1);
    const paths = label.children.map((b) => b.dataset.path);
    expect(paths).toContain('enabled');
    expect(paths).toContain('highlightThreshold');
    expect(paths).toContain('weights.clickRate');
    expect(paths).toContain('cacheTtls.registry');
    expect(new Set(paths).size).toEqual(paths.length); // 同行多键不重复
  });
});

describe('点击委托 → resetOne（单键恢复默认完整链路）', () => {
  it('顶层键：默认值写入 currentSettings → renderSettings 整面板重渲染 → 防抖保存', async () => {
    docClickHandler({ target: createdButtons.find((b) => b.dataset.path === 'enabled') });
    await vi.waitFor(() => expect(OPTS.renderSettings).toHaveBeenCalled());
    expect(OPTS.currentSettings.enabled).toEqual(false); // 恢复为默认
    expect(OPTS.scheduleAutoSave).toHaveBeenCalled();
    expect(OPTS.renderSettings.mock.calls[0][0]).toEqual(OPTS.currentSettings); // 单源应用器收到合并结果
  });

  it('嵌套键（weights.clickRate）：深路径写入不影响兄弟键', async () => {
    docClickHandler({ target: createdButtons.find((b) => b.dataset.path === 'weights.clickRate') });
    await vi.waitFor(() => expect(OPTS.currentSettings.weights.clickRate).toEqual(0.2));
    expect(OPTS.currentSettings.weights.nested).toEqual({ a: 9 }); // 兄弟键原样
  });

  it('TTL 键（cacheTtls.registry）：对象默认值整体替换', async () => {
    docClickHandler({ target: createdButtons.find((b) => b.dataset.path === 'cacheTtls.registry') });
    await vi.waitFor(() => expect(OPTS.currentSettings.cacheTtls.registry).toEqual({ value: 30, unit: 'day' }));
  });

  it('默认值缺失的未知 path：不动当前设置（防御）', () => {
    const before = JSON.stringify(OPTS.currentSettings);
    docClickHandler({
      target: { closest: () => ({ dataset: { path: 'nonexistent.key' }, getAttribute: () => 'nonexistent.key' }) }
    });
    expect(JSON.stringify(OPTS.currentSettings)).toEqual(before);
  });

  it('非 ↺ 按钮目标：委托不动作', () => {
    const before = JSON.stringify(OPTS.currentSettings);
    docClickHandler({ target: { closest: () => null } });
    expect(JSON.stringify(OPTS.currentSettings)).toEqual(before);
  });
});
