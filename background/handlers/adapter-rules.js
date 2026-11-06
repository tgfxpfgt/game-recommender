/**
 * 游戏雷达 Game Radar - 消息处理：适配器规则 / Adapter-Rules Handlers
 *
 * v14 B10：由 handlers.js 迁出——规则读取/保存/删除（保存与删除后同步
 * 自定义站点内容脚本注册）。
 * Moved from handlers.js (B10): adapter rules read/save/delete with
 * site-scripts sync on change.
 */
import { saveAdapterRules, deleteAdapterRules, getAllRules } from '../core/rules.js';
import { syncSiteScripts } from '../core/site-scripts.js';
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from '../core/constants.js';
import { reloadRetrievalRules } from '../steam/api-search.js'; // v14.16.0 O6：回放门热更
import { applyVocabOverride, resetVocabOverride } from '../../shared/retrieval-vocab.js'; // v14.16.0 O6：内存态先行/回滚
import { parseGameTitle } from '../core/title-parser.js';
import { nameMatchesSearch, matchCandidateScore } from '../steam/api-search.js';
import '../../shared/mismatch-anchors.js'; // v14.16.0 O6：错题库锚点（IIFE 副作用挂载 globalThis）
import { Logger } from '../storage/logger.js';

async function handleGetAdapterRules() {
  const rules = await getAllRules();
  // v14.8 批次 1（R2）：词表覆盖随规则包导出（仅覆盖增量，内置词表不随包）
  try {
    const override = await dataStore.readModule(DB_KEYS.RETRIEVAL_VOCAB_OVERRIDE);
    if (override && typeof override === 'object' && rules.merged) {
      rules.merged.retrievalVocab = override;
    }
  } catch {
    /* 读取失败按无词表覆盖导出 */
  }
  return { rules };
}

async function handleSaveAdapterRules(message) {
  const result = await saveAdapterRules(message.rules);
  // v7.4.0：规则变化后同步自定义站点内容脚本注册（新增站点立即生效，
  // 无需等下一次 SW 启动）
  if (result.ok) syncSiteScripts().catch(() => {});
  // v14.8 批次 1（R2）：规则包 v2 词表覆盖段——写入 override 存储 + 热更
  // （applyVocabOverride 校验失败返回 errors，现值保持 = 回退语义）
  if (result.ok && result.vocabSegment) {
    try {
      // v14.16.0 O6：导入门三步——①新词表**内存态先行**（不落盘）+ 结构校验
      //（PROTECTIVE_TITLES 双防线在此生效）②热更编译产物后离线回放错题库 5
      // 锚点（纯函数零网络）③不达标回滚内置词表整包拒绝；达标才落盘+热更。
      // （首版缺陷：ensure 读的是旧存储覆盖、replay 跑在旧词表上——修为
      // applyVocabOverride(segment) 直接内存生效。）
      const applyErrors = applyVocabOverride(result.vocabSegment);
      if (applyErrors.length > 0) {
        result.vocabApplied = false;
        result.vocabErrors = applyErrors;
        return result;
      }
      const anchors = globalThis.__GR_MISMATCH_ANCHORS__;
      if (!anchors || typeof anchors.replay !== 'function') {
        resetVocabOverride();
        result.vocabApplied = false;
        result.vocabErrors = ['错题库锚点未加载（回放门不可用）——整包拒绝'];
        Logger.warn('AdapterRules', result.vocabErrors[0]);
        return result;
      }
      const replay = anchors.replay({ parseGameTitle, nameMatchesSearch, matchCandidateScore });
      if (replay.failed.length > 0) {
        resetVocabOverride(); // 回滚内置词表（编译产物随 reset 热更）
        reloadRetrievalRules();
        result.vocabApplied = false;
        result.vocabErrors = replay.failed.map((f) => f.id + ': ' + f.why);
        Logger.warn('AdapterRules', '词表回放门拒绝（回滚内置词表）: ' + result.vocabErrors.join(' | '));
        return result;
      }
      await dataStore.writeModule(DB_KEYS.RETRIEVAL_VOCAB_OVERRIDE, result.vocabSegment);
      reloadRetrievalRules();
      result.vocabApplied = true;
    } catch (e) {
      resetVocabOverride();
      result.vocabApplied = false;
      result.vocabErrors = [String(e)];
    }
  }
  return result;
}

async function handleDeleteAdapterRules() {
  await deleteAdapterRules();
  // 规则删除后自定义站点脚本残留注册无碍（tracker 按规则早退兜底）——
  // 不注销，保持幂等简单；仍同步以补注册其他新站点
  syncSiteScripts().catch(() => {});
  // v9.7.0：补 ok 字段——UI（panels/rules.js）判 resp.ok，此前恒 undefined
  // 导致"恢复内置规则"成功后无任何反馈
  return { ok: true, success: true };
}

// v14 B10：领域 handler 段（action → handler 单处声明，handlers.js 聚合展开）
export const adapterRulesHandlers = {
  GET_ADAPTER_RULES: handleGetAdapterRules,
  SAVE_ADAPTER_RULES: handleSaveAdapterRules,
  DELETE_ADAPTER_RULES: handleDeleteAdapterRules
};
