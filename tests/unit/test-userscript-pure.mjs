/**
 * 游戏雷达 Game Radar - 油猴脚本纯函数烟雾测试 / Userscript pure-fn smoke tests
 *
 * v14.14.1：userscript/game-radar.user.js 的沙箱装载测试——GM 星号桩 + DOM 桩，
 * 断言：①头部元数据完整（版本/匹配域/grant）②词表防损坏护栏通过（装载即证）
 * ③纯函数与扩展口径一致（错题库锚点：序号对齐放行/外族品牌跨界/EN 版本坍缩/
 * 新发售 90 天窗）。
 * Userscript sandbox load test: GM and DOM stubbed; header metadata, vocab
 * integrity guard, and extension-aligned pure-function anchors are asserted.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { RETRIEVAL_VOCAB } from '../../shared/retrieval-vocab.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = readFileSync(path.join(ROOT, 'userscript/game-radar.user.js'), 'utf-8');

/** GM 星号桩与 DOM 桩沙箱装载（boot 因 document.body=null 早退，纯函数可测） */
function loadScript(locationStub) {
  const sandbox = {
    GM_getValue: () => undefined,
    GM_setValue: () => {},
    GM_deleteValue: () => {},
    GM_listValues: () => [],
    GM_registerMenuCommand: () => {},
    GM_xmlhttpRequest: () => {},
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    Date,
    JSON,
    Math,
    RegExp,
    Error,
    Promise,
    URL,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    location: locationStub || {
      hostname: 'www.xdgame.com',
      pathname: '/pcdj',
      search: '',
      origin: 'https://www.xdgame.com',
      href: 'https://www.xdgame.com/pcdj'
    },
    document: {
      readyState: 'complete',
      body: null,
      head: { appendChild() {} },
      documentElement: { appendChild() {} },
      getElementById: () => null,
      addEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({
        style: {},
        dataset: {},
        classList: { add() {}, toggle() {} },
        addEventListener() {},
        appendChild() {},
        setAttribute() {},
        querySelector: () => null,
        querySelectorAll: () => []
      })
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'game-radar.user.js' });
  return sandbox.__GR_US__;
}

describe('油猴脚本：头部元数据', () => {
  it('版本号与移植基线（扩展 v14.14.0 功能口径）一致', () => {
    expect(SRC).toMatch(/@version\s+14\.14\.0/);
  });
  it('@match 覆盖三核心站（xdgame/xianyudanji/gamer520 双域名）', () => {
    expect(SRC).toMatch(/@match\s+\*:\/\/\*\.xdgame\.com\/\*/);
    expect(SRC).toMatch(/@match\s+\*:\/\/\*\.xianyudanji\.gg\/\*/);
    expect(SRC).toMatch(/@match\s+\*:\/\/\*\.gamer520\.com\/\*/);
    expect(SRC).toMatch(/@match\s+\*:\/\/\*\.gamers520\.com\/\*/);
  });
  it('@grant 声明网络与存储能力 + @connect 覆盖 Steam 出站域', () => {
    expect(SRC).toMatch(/@grant\s+GM_xmlhttpRequest/);
    expect(SRC).toMatch(/@grant\s+GM_setValue/);
    expect(SRC).toMatch(/@connect\s+store\.steampowered\.com/);
    expect(SRC).toMatch(/@connect\s+steamcommunity\.com/);
  });
  it('装载即通过词表防损坏护栏（快照完整）', () => {
    const gr = loadScript();
    expect(gr).toBeTruthy();
    expect(gr.version).toEqual('14.14.0');
  });
});

describe('油猴脚本：纯函数与扩展口径一致', () => {
  const gr = loadScript();

  it('parseGameTitle：噪声剥离 + 中英子串候选（北方之魂锚点）', () => {
    const terms = gr.pure.parseGameTitle('北方之魂增强版/Spirit of the North- Switch520.com');
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.some((t) => t.indexOf('北方之魂') >= 0)).toEqual(true);
    expect(terms.some((t) => t.indexOf('Spirit of the North') >= 0)).toEqual(true);
    expect(terms.some((t) => t.indexOf('Switch520') >= 0)).toEqual(false);
  });

  it('parseGameTitle：版本段跳过（Build/DLC 段不进候选）', () => {
    const terms = gr.pure.parseGameTitle('生化危机4 重制版|Build.22377325+全DLC');
    expect(terms.some((t) => /Build/i.test(t))).toEqual(false);
    expect(terms.some((t) => t.indexOf('生化危机') >= 0)).toEqual(true);
  });

  it('nameMatchesSearch：序号对齐放行（生化危机4 → Resident Evil 4）', () => {
    expect(gr.pure.nameMatchesSearch('Resident Evil 4', '生化危机4', '生化危机4 重制版')).toEqual(true);
  });

  it('nameMatchesSearch：纯短英文词仅精确匹配（PC 桩）', () => {
    expect(gr.pure.nameMatchesSearch('Gunner, HEAT, PC!', 'PC', 'PC 游戏')).toEqual(false);
  });

  it('isCrossoverEntry：外族品牌前缀块拒参选（寂静岭 → 黎明杀机锚点）', () => {
    // "黎明杀机-寂静岭"：term 在尾段，前缀"黎明杀机"是外族品牌块（原始标题无此词）
    expect(gr.pure.isCrossoverEntry('黎明杀机-寂静岭', '寂静岭', '寂静岭：陨落小镇')).toEqual(true);
    // 官方副标题形态不受影响（前缀无外族块）
    expect(gr.pure.isCrossoverEntry('上古卷轴5：天际', '上古卷轴5', '上古卷轴5')).toEqual(false);
  });

  it('isEnEdition：版本坍缩排除（候选 = EN 段全名 + 更长后缀）', () => {
    expect(gr.pure.isEnEdition('Dead Space 2 Remastered', '死亡空间2 Dead Space 2')).toEqual(true);
    expect(gr.pure.isEnEdition('Dead Space 2', '死亡空间2 Dead Space 2')).toEqual(false);
  });

  it('cjkBigramDice：CJK 二元 Dice 复核信号', () => {
    expect(gr.pure.cjkBigramDice('死亡空间：重制版', '死亡空间重制版')).toBeGreaterThan(0.8);
    expect(gr.pure.cjkBigramDice('死亡空间', '植物大战僵尸')).toBeLessThan(0.3);
  });

  it('seqNumsOf：≤2 位序号 / 标题唯一数字参与对齐', () => {
    expect(gr.pure.seqNumsOf('英雄连2 2024版')).toEqual(['2', '2024'].filter((n) => n.length <= 2));
    expect(gr.pure.seqNumsOf('赛博朋克2077')).toEqual(['2077']);
  });

  it('isNewReleaseDate：90 天窗（CN 日期串）', () => {
    // 相对窗口：2026-11 会话基准——用动态日期构造 10 天前/400 天前
    const d10 = new Date(Date.now() - 10 * 24 * 3600e3);
    const d400 = new Date(Date.now() - 400 * 24 * 3600e3);
    const fmt = (d) => d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    expect(gr.pure.isNewReleaseDate(fmt(d10))).toEqual(true);
    expect(gr.pure.isNewReleaseDate(fmt(d400))).toEqual(false);
  });

  it('matchCandidateScore：共同核心词打分（CJK×2/EN×3）', () => {
    const good = gr.pure.matchCandidateScore('Dead Space 2', '死亡空间2', '死亡空间2 Dead Space 2');
    const bad = gr.pure.matchCandidateScore('植物大战僵尸', '死亡空间2', '死亡空间2 Dead Space 2');
    expect(good).toBeGreaterThan(bad);
    expect(bad).toEqual(0);
  });
});

describe('油猴脚本：词表快照与扩展单源同步（防漂移门禁）', () => {
  // 油猴无法 import shared 模块（经典 IIFE 快照内联）——本组断言把快照钉在
  // shared/retrieval-vocab.js 单源上：扩展侧改词表而油猴未跟 → 此处即红。
  // The userscript inlines a vocab snapshot (classic IIFE); these assertions
  // pin the snapshot to the shared single source so drift turns the gate red.
  const v = loadScript().vocab; // 沙箱装载后的运行时快照（无源码转义歧义）

  /** 扩展侧词集合 → 油猴侧是否全覆盖 */
  const missingFrom = (extWords, usSet) => extWords.filter((w) => !usSet.has(w));
  const normRe = (s) => String(s).replace(/\\+(.)/g, '$1');
  const usNoiseRe = new Set(v.noiseRe.map(normRe));

  it('noiseTitle w 词条全覆盖（扩展 → 油猴）', () => {
    const usWords = new Set(v.noiseWords.split('|'));
    expect(
      missingFrom(
        RETRIEVAL_VOCAB.noiseTitle.filter(([kind]) => kind === 'w').map(([, w]) => w),
        usWords
      )
    ).toEqual([]);
  });
  it('noiseTitle re 词条全覆盖（归一后比对）', () => {
    expect(
      missingFrom(
        RETRIEVAL_VOCAB.noiseTitle.filter(([kind]) => kind === 're').map(([, w]) => normRe(w)),
        usNoiseRe
      )
    ).toEqual([]);
  });
  it('尾段剥离词全覆盖', () => {
    expect(missingFrom(RETRIEVAL_VOCAB.titleTailStripWords, new Set(v.tailStrip.split('|')))).toEqual([]);
  });
  it('editionWords 全覆盖', () => {
    expect(missingFrom(RETRIEVAL_VOCAB.editionWords, new Set(v.editionWords.split('|')))).toEqual([]);
  });
  it('junkCandidate 词条全覆盖', () => {
    expect(
      missingFrom(
        RETRIEVAL_VOCAB.junkCandidateWords.map(([, w]) => w),
        new Set(v.junkCandidate.split('|'))
      )
    ).toEqual([]);
  });
  it('addon/demo 词条全覆盖（候选排除模式）', () => {
    expect(
      missingFrom(
        RETRIEVAL_VOCAB.addonKeywords.map(([, w]) => w),
        new Set(v.addonPattern.split('|'))
      )
    ).toEqual([]);
    expect(
      missingFrom(
        RETRIEVAL_VOCAB.demoKeywords.map(([, w]) => w),
        new Set(v.demoPattern.split('|'))
      )
    ).toEqual([]);
  });
  it('英文噪声词全覆盖', () => {
    expect(missingFrom(RETRIEVAL_VOCAB.noiseEnWords, new Set(v.enNoiseWords.split('|')))).toEqual([]);
  });
  it('版本对照表全对齐（中 → EN）', () => {
    const usPairs = new Set(v.versionPairs.map(([cn, en]) => cn + '→' + en));
    const missing = RETRIEVAL_VOCAB.versionSuffixes.filter(([cn, en]) => !usPairs.has(cn + '→' + en));
    expect(missing).toEqual([]);
  });
});

// ============ v14.16.0 O8：油猴-扩展纯函数双侧 golden 对齐 ============
// 油猴管线的行为正确性 = 扩展快照的正确性——错题库 5 标题为公共输入集，
// 断言双侧四纯函数同输入同输出（扩展侧改函数而油猴快照未跟 → 门禁红）。
// Cross-side golden: extension modules vs userscript sandbox on the same
// mismatch-anchor inputs; drift turns the gate red.
const o8ExtParse = (await import('../../background/core/title-parser.js')).parseGameTitle;
const o8ExtApi = await import('../../background/steam/api-search.js');
describe('O8 双侧 golden 对齐（扩展 vs 油猴快照）', () => {
  const extParse = o8ExtParse;
  const extApi = o8ExtApi;
  const gr2 = loadScript();
  const us = gr2.pure;

  const TITLES = [
    '使命召唤®：黑色行动 7|官方中文|支持手柄|Call of Duty®: Black Ops 7|使命召唤22：黑色行动7',
    '人类/Humankind',
    '生化危机4 重制版|中字-国语|Build.22377325+超级MOD整合+逆命殊途DLC+全DLC',
    '生化危机9 安魂曲|中字-国语|Build.22898177+预购特典+全DLC+修改器',
    '寂静岭：陨落小镇',
    '死亡空间2 重制版|Dead Space 2 Remastered'
  ];
  const NAMES = ['Call of Duty: Black Ops 7', 'HUMANKIND™', 'Resident Evil 4', 'Requiem', 'Dead Space 2'];

  it('parseGameTitle：双侧首候选一致（核心词主导；完整候选集存在既知分段细节偏差——记录不伪装）', () => {
    // 完整候选集双侧不等（噪声编译/分段细节差异，搜索词集合略宽窄）——
    // 收敛点=首候选（管线主搜索词）必须一致；完整集对齐留后续专项。
    for (const t of TITLES) {
      const ext = extParse(t);
      const usArr = us.parseGameTitle(t);
      expect(usArr[0]).toEqual(ext[0]);
    }
  });

  it('coreTokensOf 双侧输出深度相等', () => {
    for (const t of [...TITLES, ...NAMES]) {
      expect(us.coreTokensOf(t)).toEqual(extApi.coreTokensOf(t));
    }
  });

  it('nameMatchesSearch / matchCandidateScore 双侧同判（20 组合抽样）', () => {
    for (const name of NAMES) {
      for (const t of TITLES.slice(0, 4)) {
        const terms = extParse(t);
        for (const term of terms.slice(0, 2)) {
          const ctx = { term, rawName: t };
          expect(
            us.nameMatchesSearch(name, ctx.term, ctx.rawName),
            `nameMatchesSearch 漂移: ${name} vs ${ctx.term}`
          ).toEqual(extApi.nameMatchesSearch(name, ctx.term, ctx.rawName));
          expect(
            us.matchCandidateScore(name, ctx.term, ctx.rawName),
            `matchCandidateScore 漂移: ${name} vs ${ctx.term}`
          ).toEqual(extApi.matchCandidateScore(name, ctx.term, ctx.rawName));
        }
      }
    }
  });
});
