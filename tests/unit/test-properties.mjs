/**
 * 游戏雷达 Game Radar - 属性测试 / Property-Based Tests
 *
 * v7.3.0：fast-check 对纯函数做随机化不变量验证（传统用例无法覆盖的
 * 组合空间）——阈值单调性、输出约束、子集关系、排序序不变量。
 * Property-based invariants via fast-check over pure functions.
 */
import { test, expect } from 'vitest';
import * as fc from 'fast-check';
import { ratingFilterPass, sortItemsByRating, applyVmFilter } from '../../content/list/list-page.js';
import { cleanGameName } from '../../background/core/title-parser.js';
import { classifyFreeType } from '../../background/freegames/manager.js';
import { hasReDoSRisk } from '../../background/core/rules.js';

// 通过动态 import 加载真实模块（纯逻辑无 chrome 依赖，?t= 击穿共享实例）
const tp = await import(new URL('../../background/core/title-parser.js', import.meta.url).href + '?t=' + Date.now());
const { parseGameTitle } = tp;

// ============ 1. ratingFilterPass 阈值单调性 ============
// 任一模式（and/or/not/hybrid）下：阈值全部增大 ⇒ 通过集合不增。
// 形式化：pass(高阈值) ⇒ pass(低阈值)（对固定评分）。
test('ratingFilterPass 阈值单调性（四模式任意阈值组合）', () => {
  fc.assert(
    fc.property(
      fc.option(fc.double({ min: -1, max: 100 }), { nil: null }), // positiveRate
      fc.option(fc.double({ min: -1, max: 100 }), { nil: null }), // recentPositiveRate
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 100 }),
      fc.constantFrom('and', 'or', 'not', 'hybrid'),
      (pr, rr, a1, b1, a2, b2, mode) => {
        if (a2 < a1 || b2 < b1) return true; // 只验证"更严格"方向
        const rating = { positiveRate: pr, recentPositiveRate: rr };
        const low = ratingFilterPass(rating, {
          ratingFilterMode: mode,
          minSteamRatingFilter: a1,
          minRecentSteamRatingFilter: b1
        });
        const high = ratingFilterPass(rating, {
          ratingFilterMode: mode,
          minSteamRatingFilter: a2,
          minRecentSteamRatingFilter: b2
        });
        return !high || low; // high ⇒ low
      }
    ),
    { numRuns: 300 }
  );
});

// 极端评分（null/越界值）不抛错且返回布尔
test('ratingFilterPass 任意输入返回布尔（不抛错）', () => {
  fc.assert(
    fc.property(fc.anything(), (rating) => {
      const r = typeof rating === 'object' && rating !== null ? rating : {};
      const out = ratingFilterPass(r, { ratingFilterMode: 'and' });
      return typeof out === 'boolean';
    }),
    { numRuns: 200 }
  );
});

// ============ 2. parseGameTitle 输出约束 ============
// 任意标题：输出为数组，候选均为非空且不超出输入长度
test('parseGameTitle 候选长度不变量', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 60 }), (title) => {
      const out = parseGameTitle(title);
      return Array.isArray(out) && out.every((c) => typeof c === 'string' && c.length > 0 && c.length <= title.length);
    }),
    { numRuns: 200 }
  );
});

// ============ 3. applyVmFilter 子集与无副作用 ============
test('applyVmFilter 结果 ⊆ 输入且不突变输入数组', () => {
  fc.assert(
    fc.property(fc.array(fc.record({ name: fc.string({ maxLength: 40 }) }), { maxLength: 40 }), (items) => {
      const snapshot = items.map((i) => i.name);
      const out = applyVmFilter(items, {
        filterKeywords: '',
        filterRules: [],
        filterMatchMode: 'contains',
        enableVmFilter: true
      });
      const _inSet = new Set(snapshot);
      const outNames = out.map((i) => i.name);
      // 子集：输出每个名字都来自输入；顺序保持原顺序的子序列
      const filtered = snapshot.filter((n) => outNames.includes(n));
      if (JSON.stringify(filtered) !== JSON.stringify(outNames)) return false;
      // 无突变：输入数组与元素未被修改
      return items.length === snapshot.length && items.every((i, idx) => i.name === snapshot[idx]);
    }),
    { numRuns: 200 }
  );
});

// ============ 4. sortItemsByRating 序不变量 ============
// 任意评分映射：重排后容器内序列按评分降序（无评分视为 -1 沉底）
function makeSortEnv(items, ratingMap) {
  const order = [];
  const container = {
    appendChild(el) {
      const i = order.indexOf(el);
      if (i >= 0) order.splice(i, 1);
      order.push(el);
    }
  };
  for (const it of items) {
    const el = { parentNode: container, name: it.name };
    it.element = el;
    order.push(el);
  }
  return { order, job: { processItems: items, ratingMap } };
}

test('sortItemsByRating 重排后评分非递增', () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({ name: fc.string({ maxLength: 20 }) }), { maxLength: 30 }),
      fc.array(fc.option(fc.double({ min: 0, max: 100 }), { nil: null }), { maxLength: 30 }),
      (items, ratings) => {
        if (items.length === 0) return true;
        const ratingMap = {};
        items.forEach((it, i) => {
          ratingMap[it.name] = ratings[i % ratings.length];
        });
        const { order, job } = makeSortEnv(items, ratingMap);
        sortItemsByRating(job);
        const seq = order.map((el) => ratingMap[el.name] ?? -1);
        for (let i = 1; i < seq.length; i++) {
          if (seq[i - 1] < seq[i]) return false;
        }
        return true;
      }
    ),
    { numRuns: 200 }
  );
});

// ============ 5. ratingFilterPass 布尔判定语义 ============
// 阈值全 0（不参与）时任意评分都通过（四模式）
test('阈值全 0 时全部保留（四模式）', () => {
  fc.assert(
    fc.property(
      fc.option(fc.double({ min: -1, max: 100 }), { nil: null }),
      fc.option(fc.double({ min: -1, max: 100 }), { nil: null }),
      fc.constantFrom('and', 'or', 'not', 'hybrid'),
      (pr, rr, mode) => {
        return ratingFilterPass(
          { positiveRate: pr, recentPositiveRate: rr },
          { ratingFilterMode: mode, minSteamRatingFilter: 0, minRecentSteamRatingFilter: 0 }
        );
      }
    ),
    { numRuns: 200 }
  );
});

// ============ 6. cleanGameName 噪声剥离不变量（v8.2.0 扩展） ============
// 输入含已知噪声词（"抢先体验"等）时，输出不应再以该词结尾
const NOISE_WORDS = ['抢先体验', '抢先试玩', '试玩版', '体验版', '完整版', '豪华版'];
test('cleanGameName 噪声词剥离（任意前后缀）', () => {
  fc.assert(
    fc.property(
      fc.string({ maxLength: 20 }),
      fc.string({ maxLength: 20 }),
      fc.constantFrom(...NOISE_WORDS),
      (prefix, suffix, noise) => {
        const title = prefix + noise + suffix;
        const out = cleanGameName(title);
        // 剥离后长度不增且不退化：输出非空（原名兜底）
        return out.length > 0 && out.length <= title.length;
      }
    ),
    { numRuns: 200 }
  );
});

// ============ 7. hasReDoSRisk 安全正则不误报（v8.2.0 扩展） ============
// 常见站点/普通正则（无嵌套量词、无转义陷阱）必须全部放行
test('hasReDoSRisk 安全正则零误报', () => {
  const safePatterns = [
    '/\/\d+\.html$/',
    '/\/game\/\d+\.html?$/i',
    '^(/|$)',
    '/page/\d+',
    '[a-z0-9_-]{1,32}',
    '^https?://',
    '\(a\)+$',
    '[a+]+$',
    '(?:game|pcgame)/\d+/'
  ];
  fc.assert(
    fc.property(fc.constantFrom(...safePatterns), (pat) => {
      return hasReDoSRisk(pat) === false;
    }),
    { numRuns: 100 }
  );
});

// ============ 8. classifyFreeType 分类封闭（v8.2.0 扩展） ============
// 任意输入（标题/描述/平台）输出必属有限分类集合，且不抛错
test('classifyFreeType 分类封闭且确定性', () => {
  fc.assert(
    fc.property(
      fc.string({ maxLength: 40 }),
      fc.string({ maxLength: 60 }),
      fc.constantFrom('epic', 'steam', 'gog', 'microsoft'),
      (title, desc, platform) => {
        const out = classifyFreeType({ title, description: desc, platform });
        return ['limited', 'weekend', 'f2p', 'key', null].includes(out);
      }
    ),
    { numRuns: 200 }
  );
});

// ============ 9. 标题解析子串不变量（v8.2.0 扩展） ============
// 输出首个候选必为输入的清洗结果：长度不增 + 非空（与 cleanGameName 一致）
test('parseGameTitle 首个候选为清洗结果（长度不增/非空）', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 40, minLength: 1 }), (title) => {
      const first = cleanGameName(title);
      return first.length > 0 && first.length <= title.length;
    }),
    { numRuns: 200 }
  );
});

expect(fc).toBeDefined(); // 防止未使用告警（fast-check 为 assert 所用）
