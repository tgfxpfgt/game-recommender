/**
 * 游戏雷达 Game Radar - 跨词共识 + 盲区自愈单测（v14.8.2 专项）
 *
 * 专项 A：isCrossoverEntry 外族前缀跨界条目检测（实测 term=寂静岭 仅返回
 * "黎明杀机-寂静岭"，该 DLC 解析成黎明杀机正主 = 错配链）+ searchSteamAppId
 * 跨词共识终选（同 appId 多词命中加成）。
 * 专项 B：extractSteamAppIdSignals 详情页信号提取 + getSteamPositiveRate
 * miss 后详情页信号回捞（appdetails 相关性校验防误标）+ 任务预算有界。
 * Anchor-safe: 全部错题样本（mismatch-samples + 三站基准）由既有回放套件
 * 锁定，本文件只锁新增语义。
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { installFetchMock } from '../helpers/fetch-mock.mjs';

await import('../../shared/escape.js');
const storage = createStorageMock();
installChromeStorageMock(storage);
globalThis.window = globalThis.window || {};
globalThis.location = globalThis.location || { href: 'http://test/', search: '', origin: 'http://test' };
globalThis.chrome = globalThis.chrome || { runtime: { getManifest: () => ({ version: '0-test' }) } };

const api = await import('../../background/steam/api-search.js');
const shared = await import('../../background/steam/orchestrator-shared.js');

const SILENT_HILL_RAW = '寂静岭：陨落小镇|v1.6.155963|豪华版|官方中文|支持手柄|SILENT HILL';

describe('isCrossoverEntry（外族前缀跨界条目检测）', () => {
  test('黎明杀机-寂静岭 之于 寂静岭标题 → 跨界（外族品牌前缀）', () => {
    expect(api.isCrossoverEntry('黎明杀机-寂静岭', '寂静岭', SILENT_HILL_RAW)).toBe(true);
  });

  test('正主全名（前缀无外族块）→ 非跨界', () => {
    expect(api.isCrossoverEntry('寂静岭：陨落小镇', '寂静岭', SILENT_HILL_RAW)).toBe(false);
  });

  test('官方名副标题后缀（上古卷轴5：天际）→ 非跨界（仅前缀形状）', () => {
    expect(api.isCrossoverEntry('上古卷轴5：天际', '上古卷轴5', '上古卷轴5|官方中文')).toBe(false);
  });

  test('版本后缀外块（豪华版不在站名时）经 noiseTitle 剥离 → 非跨界', () => {
    expect(api.isCrossoverEntry('寂静岭：陨落小镇豪华版', '寂静岭', '寂静岭：陨落小镇|官方中文')).toBe(false);
  });

  test('候选名不含搜索词 / 搜索词位于开头 → 不进入检测', () => {
    expect(api.isCrossoverEntry('永恒终焉：4KHD版', '永恒的尽头', '永恒的尽头：4K / 高清版|RESONANCE')).toBe(false);
    expect(api.isCrossoverEntry('寂静岭：陨落小镇', '寂静岭：陨落小镇', SILENT_HILL_RAW)).toBe(false);
  });

  test('夜族崛起恶魔城传奇典藏包 之于 恶魔城标题 → 跨界', () => {
    expect(api.isCrossoverEntry('夜族崛起恶魔城传奇典藏包', '恶魔城', '恶魔城：月下夜想曲|官方中文')).toBe(true);
  });
});

describe('cjkBigramDice（同语言候选复核信号）', () => {
  test('同源名高相似 / 无关名低相似 / 无 CJK 判 -1', () => {
    expect(api.cjkBigramDice('可口的披萨美味的披萨', '美味的披萨可口的披萨')).toBeGreaterThan(0.5);
    expect(api.cjkBigramDice('寂静岭：陨落小镇', '黎明杀机')).toBeLessThan(0.28);
    expect(api.cjkBigramDice('泰坦之旅2', 'Titan Quest II')).toBe(-1);
  });
});

describe('extractSteamAppIdSignals（详情页信号提取）', () => {
  test('按出现次数降序去重（主图信号优先）', () => {
    const html = [
      '<img src="https://cdn.steamstatic.com/steam/apps/1154030/header.jpg">',
      '<img src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1154030/capsule.jpg">',
      '<img src="https://queniuqe.cdn/store_item_assets/steam/apps/999999/a.jpg">',
      '<img src="https://x/store_item_assets/steam/apps/1154030/footer.jpg">'
    ].join('');
    expect(shared.extractSteamAppIdSignals(html)).toEqual(['1154030', '999999']);
  });

  test('无信号 → 空数组', () => {
    expect(shared.extractSteamAppIdSignals('<html>没有信号</html>')).toEqual([]);
  });
});

describe('跨词共识终选（同 appId 多词命中加成）', () => {
  beforeEach(() => {
    storage._reset();
  });

  test('单词高分候选 vs 两词共同命中候选 → 共识候选胜出', async () => {
    // 词1"圣剑"：高分噪声候选（含词1 + 共同词少）；词2"传说"与词3"剑界"：
    // 同一正主（250000）两词命中 → 共识 +2 胜过单词 3 分噪声
    const recorded = {
      圣剑: { total: 1, items: [{ type: 'game', id: 111111, name: '圣剑编年史' }] },
      传说: { total: 1, items: [{ type: 'game', id: 250000, name: '圣剑传说：剑界复苏' }] },
      剑界: { total: 1, items: [{ type: 'game', id: 250000, name: '圣剑传说：剑界复苏' }] }
    };
    const restore = installFetchMock(async (url) => {
      const u = decodeURIComponent(String(url));
      const m = u.match(/term=([^&]+)/);
      const payload = recorded[m ? m[1] : ''] || { total: 0, items: [] };
      return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
    });
    try {
      const r = await api.searchSteamAppId(['圣剑', '传说', '剑界'], '圣剑传说：剑界|官方中文', null);
      expect(r && String(r.appId)).toEqual('250000');
    } finally {
      restore();
    }
  });
});

describe('详情页信号回捞（storesearch 盲区自愈）', () => {
  beforeEach(() => {
    storage._reset();
  });

  /** @param {Record<string, any>} routes URL 片段 → 响应体 */
  function installProbe(routes) {
    return installFetchMock(async (url) => {
      const u = decodeURIComponent(String(url));
      if (u.includes('storesearch')) {
        return { ok: true, status: 200, json: async () => ({ total: 0, items: [] }), text: async () => '{}' };
      }
      for (const [frag, body] of Object.entries(routes)) {
        if (u.includes(frag)) {
          return {
            ok: true,
            status: 200,
            json: async () => (typeof body === 'object' ? body : JSON.parse(body)),
            text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
          };
        }
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '{}' };
    });
  }

  test('泰坦之旅2：storesearch 全空 → 详情页信号 1154030 经 appdetails 校验命中', async () => {
    const orch = await import('../../background/steam/orchestrator-list.js');
    const detailHtml =
      '<html><img src="https://cdn.akamai.steamstatic.com/store_item_assets/steam/apps/1154030/header.jpg"></html>';
    const restore = installProbe({
      '/titan-quest-2-page.html': detailHtml,
      '/api/appdetails': {
        1154030: { success: true, data: { steam_appid: 1154030, name: 'Titan Quest II', type: 'game' } }
      },
      '/appreviews/1154030': {
        success: 1,
        query_summary: {
          total_reviews: 128,
          total_positive: 112,
          total_negative: 16,
          review_score: 8,
          review_score_desc: '特别好评'
        },
        reviews: []
      },
      ISteamNews: { appnews: { appid: 1154030, newsitems: [] } }
    });
    try {
      const r = await orch.getSteamPositiveRate('泰坦之旅2|豪华中文|Build.26301648', {
        pageUrl: 'https://www.gamer520.com/titan-quest-2-page.html',
        probeBudget: { left: 8 },
        ignoreNegativeCache: true
      });
      expect(r && String(r.appId)).toEqual('1154030');
    } finally {
      restore();
    }
  });

  test('潜行者2 误标信号：appdetails 名与标题无关（Dice 过低）→ 拒绝维持 miss', async () => {
    const orch = await import('../../background/steam/orchestrator-list.js');
    const detailHtml =
      '<html><img src="https://cdn.akamai.steamstatic.com/store_item_assets/steam/apps/3765020/header.jpg"></html>';
    let detailsCalled = 0; // 防空转断言：探测必须真的走到 appdetails 校验再拒绝
    const restore = installFetchMock(async (url) => {
      const u = decodeURIComponent(String(url));
      if (u.includes('storesearch')) {
        return { ok: true, status: 200, json: async () => ({ total: 0, items: [] }), text: async () => '{}' };
      }
      if (u.includes('stalker2-page.html')) {
        return { ok: true, status: 200, json: async () => ({}), text: async () => detailHtml };
      }
      if (u.includes('appdetails')) {
        detailsCalled += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            3765020: { success: true, data: { steam_appid: 3765020, name: '王牌机战：星海争霸', type: 'game' } }
          }),
          text: async () => '{}'
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '{}' };
    });
    try {
      const r = await orch.getSteamPositiveRate('潜行者2 切尔诺贝利之心|豪华中文', {
        pageUrl: 'https://www.gamer520.com/stalker2-page.html',
        probeBudget: { left: 8 },
        ignoreNegativeCache: true
      });
      expect(detailsCalled).toBeGreaterThan(0); // 探测确实执行（非空转绿）
      expect(r).toEqual(null); // 校验拒绝 → 维持 miss
    } finally {
      restore();
    }
  });

  test('预算耗尽 → 不再探测（appdetails 不被调用）', async () => {
    const orch = await import('../../background/steam/orchestrator-list.js');
    let detailsCalled = 0;
    const restore = installFetchMock(async (url) => {
      const u = decodeURIComponent(String(url));
      if (u.includes('storesearch')) {
        return { ok: true, status: 200, json: async () => ({ total: 0, items: [] }), text: async () => '{}' };
      }
      if (u.includes('exhausted-page.html')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '<img src="https://x/store_item_assets/steam/apps/777777/header.jpg">'
        };
      }
      if (u.includes('appdetails')) {
        detailsCalled += 1;
        return { ok: true, status: 200, json: async () => ({ success: true, data: {} }), text: async () => '{}' };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '{}' };
    });
    try {
      await orch.getSteamPositiveRate('某个查无此游戏的名字', {
        pageUrl: 'https://www.gamer520.com/exhausted-page.html',
        probeBudget: { left: 0 },
        ignoreNegativeCache: true
      });
      expect(detailsCalled).toEqual(0);
    } finally {
      restore();
    }
  });
});
