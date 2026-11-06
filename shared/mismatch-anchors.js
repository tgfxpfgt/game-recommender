/**
 * 游戏雷达 Game Radar - 错题库运行时锚点 / Runtime Mismatch Anchors
 *
 * v14.16.0（功能报告 O6）：词表是检索大脑——规则包导入的词表覆盖此前只有
 * 结构校验（validateRetrieval Vocab 结构合法 ≠ 不劣化），坏包（噪声词误删
 * 正主词）会静默劣化全站匹配。本文件是错题库 5 锚点的运行时精简快照
 *（tests/fixtures/mismatch-samples.json 的 (标题→正主名) 对），导入词表时
 * 离线回放（纯函数，零网络）：锚点标题经 parseGameTitle 产出的搜索词对正主
 * 名的评分/相关性必须依旧成立，不达标整包拒绝。漂移门禁：test-mismatch-anchors
 * 断言本快照与 fixtures 单源一致。
 * Runtime snapshot of the 5 mismatch anchors; import-time offline replay gate.
 */
'use strict';

(function (global) {
  // 预期语义：
  //  - kind 'miss'（4 条）：parseGameTitle(cleanTitle) 产出非空搜索词，且对
  //    正主名存在某搜索词使 nameMatchesSearch 通过 + matchCandidateScore>0。
  //  - kind 'hard-miss'（寂静岭跨界）：cleanTitle 核心词未被毒化——产出词中
  //    存在包含 '寂静岭' 的词（噪声词误吞正主词即红）。
  global.__GR_MISMATCH_ANCHORS__ = {
    version: 1,
    anchors: [
      {
        id: 'xianyudanji-105165',
        cleanTitle: '使命召唤®：黑色行动 7|官方中文|支持手柄|Call of Duty®: Black Ops 7|使命召唤22：黑色行动7',
        expectedAppId: '3606490',
        expectedName: 'Call of Duty: Black Ops 7',
        kind: 'miss'
      },
      {
        id: 'xdgame-1697',
        cleanTitle: '人类/Humankind',
        expectedAppId: '1124300',
        expectedName: 'HUMANKIND™',
        kind: 'miss'
      },
      {
        id: 'gamer520-123938',
        cleanTitle: '生化危机4 重制版|中字-国语|Build.22377325+超级MOD整合+逆命殊途DLC+全DLC',
        expectedAppId: '2050650',
        expectedName: 'Resident Evil 4',
        kind: 'miss'
      },
      {
        id: 'gamer520-requiem-regression',
        cleanTitle: '生化危机9 安魂曲|中字-国语|Build.22898177+预购特典+全DLC+修改器',
        expectedAppId: '3764200',
        expectedName: 'Resident Evil Requiem',
        kind: 'miss'
      },
      {
        id: 'xianyudanji-silenthill-crossover',
        cleanTitle: '寂静岭：陨落小镇',
        expectedAppId: null,
        expectedName: '',
        kind: 'hard-miss'
      }
    ],

    /**
     * 离线回放（纯函数，零网络）。fns 注入检索纯函数（词表热更后的编译产物
     * 经由这些函数生效），返回 {passed, failed: [{id, why}]}。
     * @param {{parseGameTitle: Function, nameMatchesSearch: Function, matchCandidateScore: Function, isAddonName?: Function}} fns
     * @returns {{passed: number, failed: Array<{id: string, why: string}>}}
     */
    replay(fns) {
      /** @type {Array<{id: string, why: string}>} */
      const failed = [];
      const results = { passed: 0, failed };
      for (const a of this.anchors) {
        try {
          const terms = fns.parseGameTitle(a.cleanTitle);
          if (a.kind === 'hard-miss') {
            // 核心词未毒化：产出词中存在含 '寂静岭' 的词
            const ok = terms.some((t) => t.indexOf('寂静岭') >= 0);
            if (!ok) failed.push({ id: a.id, why: '核心词被词表毒化（产出无 寂静岭 词）' });
            else results.passed += 1;
            continue;
          }
          if (!terms || terms.length === 0) {
            failed.push({ id: a.id, why: 'parseGameTitle 产出为空（核心词被毒化）' });
            continue;
          }
          let best = 0;
          let bestTermOk = false;
          for (const term of terms) {
            const score = fns.matchCandidateScore(a.expectedName, term, a.rawTitle || a.cleanTitle);
            if (score > best) best = score;
            if (fns.nameMatchesSearch(a.expectedName, term, a.rawTitle || a.cleanTitle)) bestTermOk = true;
          }
          if (best <= 0) failed.push({ id: expectedAppIdNote(a), why: '正主名评分归零（词表劣化）' });
          else if (!bestTermOk) failed.push({ id: expectedAppIdNote(a), why: '正主名相关性校验不通过（噪声词误吞）' });
          else results.passed += 1;
        } catch (e) {
          failed.push({ id: a.id, why: '回放异常: ' + String(e) });
        }
      }
      return results;
    }
  };

  /** @param {{id: string, expectedAppId: string|null}} a */
  function expectedAppIdNote(a) {
    return a.id + '（' + (a.expectedAppId || '-') + '）';
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
