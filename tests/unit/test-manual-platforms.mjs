import { test, expect, describe, beforeEach } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：手动主机机型映射（v14.19.0）
 *
 * 覆盖：存储模块 set/get 往返与容量帽 / SET_MANUAL_PLATFORM 处理器全链
 * （机型解析 → Metacritic 抓分 → 映射持久化 → 名称索引解除）/ 三管线消费
 * （列表第一波 cache-only、第二波 phasePlatform、详情 searchSteamGame）。
 * Manual platform mapping: storage roundtrip + cap, the SET_MANUAL_PLATFORM
 * handler chain (option resolve → Metacritic fetch → persist → index clear),
 * and consumption by the three pipelines (list wave-1/wave-2, detail search).
 */

import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { installFetchMock } from '../helpers/fetch-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

globalThis.chrome.runtime = globalThis.chrome.runtime || {};
globalThis.chrome.runtime.getPlatformInfo = async () => ({ os: 'win' });
globalThis.chrome.alarms = { create: () => {}, clear: () => {} };
globalThis.chrome.tabs = globalThis.chrome.tabs || { sendMessage: async () => ({}) };

const manualPlatforms = await import(
  new URL('../../background/storage/manual-platforms.js', import.meta.url).href + '?t=' + Date.now()
);
const handlersSteam = await import(
  new URL('../../background/handlers/steam.js', import.meta.url).href + '?t=' + Date.now()
);
const orchestratorList = await import(
  new URL('../../background/steam/orchestrator-list.js', import.meta.url).href + '?t=' + Date.now()
);
const orchestratorDetail = await import(
  new URL('../../background/steam/orchestrator-detail.js', import.meta.url).href + '?t=' + Date.now()
);
const nameIndex = await import(
  new URL('../../background/storage/name-index.js', import.meta.url).href + '?t=' + Date.now()
);

const MC_PAGE_HTML = '<html><script>window.__s = {"ratingValue":"91","something":1}</script></html>';

describe('manual-platforms 存储模块（v14.19.0）', () => {
  beforeEach(() => {
    storage._reset();
    manualPlatforms.resetManualPlatforms();
  });

  test('set/get 往返：kind/tag/mcScore 固化与钳制', async () => {
    await manualPlatforms.setManualPlatform('宝可梦传说：阿尔宙斯|官方中文', {
      kind: 'console',
      tag: 'Switch',
      mcScore: 86.6, // 四舍五入钳到 87
      mcName: 'Pokemon Legends: Arceus'
    });
    const entry = await manualPlatforms.getManualPlatform('宝可梦传说：阿尔宙斯|官方中文');
    expect(entry && entry.kind).toEqual('console');
    expect(entry && entry.tag).toEqual('Switch');
    expect(entry && entry.mcScore).toEqual(87);
    expect(entry && entry.mcName).toEqual('Pokemon Legends: Arceus');
  });

  test('容量帽：超限淘汰最早声明条目（LRU by at）', async () => {
    for (let i = 0; i < 505; i++) {
      await manualPlatforms.setManualPlatform(`游戏${i}|标题`, {
        kind: 'console',
        tag: 'PS5',
        mcScore: null,
        mcName: null
      });
    }
    expect(manualPlatforms.getManualPlatformsMemory().size).toBeLessThanOrEqual(500);
    expect(await manualPlatforms.getManualPlatform('游戏0|标题')).toEqual(null); // 最旧被淘汰
  });

  test('空 gameName 抛错（防御）', async () => {
    await expect(
      manualPlatforms.setManualPlatform('  ', { kind: 'console', tag: 'PS5', mcScore: null, mcName: null })
    ).rejects.toThrow();
  });
});

describe('SET_MANUAL_PLATFORM 处理器全链（v14.19.0）', () => {
  beforeEach(() => {
    storage._reset();
    manualPlatforms.resetManualPlatforms();
  });

  test('主机机型声明：Metacritic 抓分 + 映射持久化 + 名称索引解除', async () => {
    const restore = installFetchMock(async (url) => {
      const u = decodeURIComponent(String(url));
      if (u.includes('metacritic.com/game/pokemon-legends-arceus/')) {
        return {
          ok: true,
          status: 200,
          redirected: false,
          url: u,
          json: async () => ({}),
          text: async () => MC_PAGE_HTML
        };
      }
      return { ok: false, status: 404, redirected: false, url: u, json: async () => ({}), text: async () => '' };
    });
    try {
      // 名称索引先钉一个错误条目（模拟历史误匹配）
      await nameIndex.recordNameIndex('宝可梦传说 阿尔宙斯|v1.1.1|官方中文|Pokemon Legends Arceus', 999999);
      const resp = await handlersSteam.handleSetManualPlatform({
        gameName: '宝可梦传说 阿尔宙斯|v1.1.1|官方中文|Pokemon Legends Arceus',
        platform: 'switch',
        rawTitle: '宝可梦传说 阿尔宙斯|v1.1.1|官方中文|Pokemon Legends: Arceus'
      });
      expect(resp && resp.success).toBe(true);
      expect(resp && resp.tag).toEqual('Switch');
      expect(resp && resp.mcScore).toEqual(91);
      const entry = await manualPlatforms.getManualPlatform(
        '宝可梦传说 阿尔宙斯|v1.1.1|官方中文|Pokemon Legends Arceus'
      );
      expect(entry && entry.mcScore).toEqual(91);
      // mcName 经 trimPlatformTokens（词拼接）——冒号丢失（slug 语义等价，
      // 与 v14.17.0 trimPlatformTokens 定的口径一致）
      expect(entry && entry.mcName).toEqual('Pokemon Legends Arceus');
    } finally {
      restore();
    }
  });

  test('非法机型 id 拒绝；模拟器机型不抓 MC 分', async () => {
    const bad = await handlersSteam.handleSetManualPlatform({ gameName: '某游戏', platform: 'ps6' });
    expect(bad && bad.success).toBe(false);
    const restore = installFetchMock(async (url) => {
      throw new Error('模拟器声明不应发起网络请求: ' + String(url));
    });
    try {
      const resp = await handlersSteam.handleSetManualPlatform({ gameName: '某游戏|汉化', platform: 'emu' });
      expect(resp && resp.success).toBe(true);
      expect(resp && resp.kind).toEqual('emulator');
      expect(resp && resp.mcScore).toEqual(null);
    } finally {
      restore();
    }
  });
});

describe('管线消费映射（v14.19.0）', () => {
  beforeEach(() => {
    storage._reset();
    manualPlatforms.resetManualPlatforms();
  });

  test('列表第二波：映射条目返回 MC 终态（零 Steam 检索）', async () => {
    await manualPlatforms.setManualPlatform('塞尔达传说：王国之泪|官方中文', {
      kind: 'console',
      tag: 'Switch',
      mcScore: 96,
      mcName: 'The Legend of Zelda: Tears of the Kingdom'
    });
    const restore = installFetchMock(async (url) => {
      throw new Error('映射条目不应发起网络请求: ' + String(url));
    });
    try {
      const r = await orchestratorList.getSteamPositiveRate('塞尔达传说：王国之泪|官方中文', {
        ignoreNegativeCache: true
      });
      expect(r && r.mcScore).toEqual(96);
      expect(r && r.platformTag).toEqual('Switch');
      expect(r && r.appId).toEqual(null);
    } finally {
      restore();
    }
  });

  test('列表第一波：映射 MC 条目缓存命中直返；模拟器映射打平台标签', async () => {
    await manualPlatforms.setManualPlatform('宝可梦 朱紫|官方中文', {
      kind: 'console',
      tag: 'Switch',
      mcScore: 72,
      mcName: 'Pokemon Scarlet'
    });
    await manualPlatforms.setManualPlatform('某主机游戏|整合包', {
      kind: 'emulator',
      tag: '模拟器',
      mcScore: null,
      mcName: null
    });
    const mcHit = await orchestratorList.getSteamRatingsFromCacheOnly('宝可梦 朱紫|官方中文', {});
    expect(mcHit && mcHit.mcScore).toEqual(72);
    const emuHit = await orchestratorList.getSteamRatingsFromCacheOnly('某主机游戏|整合包', {});
    expect(emuHit && emuHit.platformOnly).toBe(true);
    expect(emuHit && emuHit.platformTag).toEqual('模拟器');
  });

  test('列表第一波：分类页提示词（platformHint）拦下模拟器条目的错误 Steam 缓存', async () => {
    // 无映射——首波仅有提示词检查（模拟器 → 平台标签；主机条目转第二波）
    const hit = await orchestratorList.getSteamRatingsFromCacheOnly('塞尔达传说：王国之泪|官方中文', {
      platformHint: '模拟器版'
    });
    expect(hit && hit.platformOnly).toBe(true);
    expect(hit && hit.platformTag).toEqual('模拟器');
  });

  test('详情管线：映射条目返回 platformOnly 形态（appId null + 数组字段齐备）', async () => {
    await manualPlatforms.setManualPlatform('荒野大镖客1：救赎|官方中文', {
      kind: 'console',
      tag: 'Switch',
      mcScore: null,
      mcName: null
    });
    const restore = installFetchMock(async (url) => {
      throw new Error('映射条目不应发起 Steam 检索: ' + String(url));
    });
    try {
      const r = await orchestratorDetail.searchSteamGame('荒野大镖客1：救赎|官方中文', { ignoreNegativeCache: true });
      expect(r && r.platformOnly).toBe(true);
      expect(r && r.appId).toEqual(null);
      expect(Array.isArray(r && r.genres)).toBe(true);
      expect(Array.isArray(r && r.reviews)).toBe(true);
    } finally {
      restore();
    }
  });
});

// ============ v14.20.0：全主机厂商机型（任天堂/索尼/微软/世嘉 + 通用） ============
describe('MANUAL_PLATFORM_OPTIONS 全主机名册（v14.20.0）', () => {
  test('名册完整性：id 唯一/≤20 字符/每项经 resolve 命中/厂商字段齐备', async () => {
    const { MANUAL_PLATFORM_OPTIONS, MANUAL_PLATFORM_BRANDS, resolveManualPlatformOption } =
      await import('../../shared/platform-detect.js');
    const ids = MANUAL_PLATFORM_OPTIONS.map((o) => o.id);
    expect(new Set(ids).size).toEqual(ids.length); // id 唯一
    for (const o of MANUAL_PLATFORM_OPTIONS) {
      expect(o.id.length).toBeLessThanOrEqual(20); // 契约 platform 上限
      expect(o.brand.length).toBeGreaterThan(0);
      expect(resolveManualPlatformOption(o.id)).toEqual(o);
    }
    // 厂商分组全覆盖：每个选项的 brand 都在分组表内，且每分组至少一项
    const brandIds = new Set(MANUAL_PLATFORM_BRANDS.map((b) => b.id));
    for (const o of MANUAL_PLATFORM_OPTIONS) expect(brandIds.has(o.brand)).toBe(true);
    for (const b of MANUAL_PLATFORM_BRANDS) {
      expect(MANUAL_PLATFORM_OPTIONS.some((o) => o.brand === b.id)).toBe(true);
    }
    // v14.21.0：通用组按 M 站分类口径补齐其余平台（M 站无分时优雅降级为机型徽章）
    for (const id of ['gb', 'gbc', 'neogeo', 'pce', 'segacd', 'atari2600', 'wonderswan']) {
      expect(resolveManualPlatformOption(id)).not.toEqual(null);
    }
    // 四大厂商齐备（用户需求：索尼/微软/任天堂/世嘉）
    for (const brand of ['nintendo', 'sony', 'microsoft', 'sega']) {
      expect(MANUAL_PLATFORM_OPTIONS.filter((o) => o.brand === brand).length).toBeGreaterThanOrEqual(4);
    }
  });

  test('世嘉 DC 声明：console 终态 + 无 EN 段时不抓分（不阻断映射）', async () => {
    storage._reset();
    manualPlatforms.resetManualPlatforms();
    const restore = installFetchMock(async (url) => {
      throw new Error('无 EN 段不应发起网络请求: ' + String(url));
    });
    try {
      const resp = await handlersSteam.handleSetManualPlatform({ gameName: ' Sonic大冒险|汉化', platform: 'dc' });
      expect(resp && resp.success).toBe(true);
      expect(resp && resp.tag).toEqual('DC');
      expect(resp && resp.kind).toEqual('console');
      const entry = await manualPlatforms.getManualPlatform(' Sonic大冒险|汉化');
      expect(entry && entry.tag).toEqual('DC');
    } finally {
      restore();
    }
  });
});

// ============ v14.22.2：候选浮窗主机入口按钮化（双视图回归守卫） ============
// 用户需求：检索错误后选主机"不直观，直接加一个按钮"——35 个机型按钮从浮窗
// 中部平铺收敛为机型选择专页（返回/Esc 双出口）。
// v14.24.0（用户需求：选择机型迁入 ⚙ 菜单）：主视图入口按钮移除——菜单
// "🎮 选择主机机型"经 openPlatformView 直达专页（sidebar.js 装配单源）。
// UI 交互无法以现有 DOM 桩行为级驱动（FakeEl 不支持 #id 选择器）——按项目
// 源码守卫惯例（sim-detail detailSrc.includes 同风格）锁定结构要素。
describe('候选浮窗主机机型专页（v14.22.2/v14.24.0/v14.29.2 源码守卫）', () => {
  test('双视图结构要素 + 键盘护栏 + Esc 自清理 + 菜单直达 + 主视图入口', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../content/detail/candidates.js', import.meta.url), 'utf8');
    expect(src.includes('id="gr-platform-view"')).toBe(true); // 机型专页容器（默认隐藏）
    expect(src.includes('id="gr-platform-back"')).toBe(true); // 专页返回按钮
    expect(src.includes('showPlatformView')).toBe(true);
    expect(src.includes('showMainView')).toBe(true);
    expect(src.includes('if (openPlatformView) showPlatformView()')).toBe(true); // 菜单直达切换
    // 专页激活时停用候选列表键盘导航（列表仅隐藏未销毁——防隐藏列表吃键盘）
    expect(src.includes("kbNav = '0'")).toBe(true);
    expect(src.includes("kbNav = '1'")).toBe(true);
    // Esc 监听自清理：面板重渲染后自摘（v14.13 B6 kbHandler 同款防泄漏模式）
    expect(src.includes('panel.contains(platformView)')).toBe(true);
    // v14.29.2（用户需求）：主视图入口按钮恢复——"手动选择游戏"面板内可直接
    // 转机型专页（v14.24.0 曾移除，用户在面板内无出口，须先关面板再找菜单）。
    // 点击绑定同一 showPlatformView 路径（与菜单直达单源）
    expect(src.includes('id="gr-platform-entry"')).toBe(true);
    expect(src.includes("querySelector('#gr-platform-entry')")).toBe(true);
    const sidebarSrc = fs.readFileSync(new URL('../../content/detail/sidebar.js', import.meta.url), 'utf8');
    expect(sidebarSrc.includes("'steam-platform'")).toBe(true); // ⚙ 菜单机型入口
  });

  test('两个调用点（未命中/报错路径）均经同一渲染函数——单源不变式', async () => {
    const fs = await import('node:fs');
    const sidebarSrc = fs.readFileSync(new URL('../../content/detail/sidebar.js', import.meta.url), 'utf8');
    const actionsSrc = fs.readFileSync(new URL('../../content/detail/sidebar-actions.js', import.meta.url), 'utf8');
    expect(sidebarSrc.includes('renderManualSelectPanel')).toBe(true); // 未命中路径
    expect(actionsSrc.includes('renderManualSelectPanel')).toBe(true); // 报错重检索路径
  });
});

// ============ v14.29.2（用户报告三连）：详情页平台预检 / manifest MC 权限 / 词表 ============
describe('详情页平台预检（v14.29.2）', () => {
  beforeEach(() => {
    storage._reset();
    manualPlatforms.resetManualPlatforms();
  });

  test('模拟器标题：searchSteamGame 零 Steam 检索直达 platformOnly 终态', async () => {
    const restore = installFetchMock(async (url) => {
      throw new Error('模拟器条目不应发起任何网络请求: ' + String(url));
    });
    try {
      const r = await orchestratorDetail.searchSteamGame('宝可梦 朱紫|NSP|模拟器|整合包', {
        ignoreNegativeCache: true
      });
      expect(r && r.platformOnly).toBe(true);
      expect(r && r.platformTag).toEqual('模拟器');
      expect(r && r.appId).toEqual(null);
    } finally {
      restore();
    }
  });

  test('主机标题（带 EN 段）：Metacritic 优先取分（MC 视图数据形态）', async () => {
    const seenUrls = [];
    const restore = installFetchMock(async (url) => {
      seenUrls.push(String(url));
      if (String(url).includes('metacritic.com/game/')) {
        return { ok: true, status: 200, text: async () => MC_PAGE_HTML };
      }
      throw new Error('主机条目仅应请求 Metacritic: ' + String(url));
    });
    try {
      const r = await orchestratorDetail.searchSteamGame('塞尔达传说 王国之泪|The Legend of Zelda|Switch移植版', {
        ignoreNegativeCache: true
      });
      expect(r && r.platformOnly).toBe(true);
      expect(r && r.platformTag).toEqual('主机');
      expect(r && r.mcScore).toEqual(91);
      expect(r && r.mcName).toBe('The Legend of Zelda');
      expect(seenUrls.some((u) => u.includes('steampowered.com'))).toBe(false); // 零 Steam 请求
    } finally {
      restore();
    }
  });

  test('PC 标题不受预检影响（无平台标记 → 常规管线）', async () => {
    // 常规管线在此桩下自然失败——只断言"发起了 Steam 检索"（预检放行）
    const restore = installFetchMock(async (url) => {
      if (String(url).includes('steampowered.com')) return { ok: false, status: 404, text: async () => '' };
      throw new Error('PC 条目不应请求其他域: ' + String(url));
    });
    try {
      const r = await orchestratorDetail.searchSteamGame('完全虚构的PC游戏名', { ignoreNegativeCache: true });
      expect(r).toEqual(null); // 检索未命中（预检已放行——走到了 Steam 检索）
    } finally {
      restore();
    }
  });
});

describe('manifest MC 域权限 + 词表「移植」标记（v14.29.2 门禁）', () => {
  test('manifest host_permissions 含 metacritic.com（缺权限 = CORS 拦截，MC 功能静默全灭）', async () => {
    const fs = await import('node:fs');
    const manifest = JSON.parse(fs.readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
    const hosts = manifest['host_permissions'] || [];
    expect(hosts.some((h) => /(^|\.)metacritic\.com/.test(h))).toBe(true);
  });

  test('MC fetch 超时走单源新键 fetchTimeoutMetacriticMs（语义错配回归：曾借 LastUpdate 4s）', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../background/steam/api-metacritic.js', import.meta.url), 'utf8');
    expect(src.includes('PERF_CONFIG.fetchTimeoutMetacriticMs')).toBe(true);
    expect(src.includes('fetchTimeoutLastUpdateMs')).toBe(false); // 借用键退场
  });

  test('裸「移植」段命中主机；PC guard 优先（PC移植版 仍判 PC）', async () => {
    const { detectPlatform } = await import('../../shared/platform-detect.js');
    expect(detectPlatform('女神异闻录5|移植版').kind).toEqual('console');
    expect(detectPlatform('大镖客|移植').kind).toEqual('console');
    expect(detectPlatform('艾尔登法环|PC移植版').kind).toEqual('pc'); // 段首 pc 守卫优先
    expect(detectPlatform('GTA5|PC版').kind).toEqual('pc'); // 既有护栏不回归
    expect(detectPlatform('PC装机模拟器').kind).toEqual('pc'); // 游戏名内含标记词不误判
  });
});
