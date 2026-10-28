// @ts-strict
/**
 * 游戏雷达 Game Radar - 检索词表覆盖装载 / Retrieval Vocab Override Loader
 *
 * v14.7 批次 12（R2 第二步骨架）：词表以**数据**经 STORAGE_MODULES 通道下发
 * （retrievalVocabOverride.json）——MV3 SW 禁动态 import（铁律 2），规则包
 * 数据只能走存储读入。启动时读取覆盖 → validateRetrievalVocab 校验 →
 * applyVocabOverride 键级合并（内置在前，追加不重排）→ reloadRetrievalRules
 * 热更导出正则；校验失败保持内置词表（回退语义）。**内容侧决策**：内容页
 * 不拉取覆盖（滞后至下次扩展更新生效）——省一条消息链，词表变更频率低。
 * R2 skeleton: the vocab override loads from storage at boot, validates,
 * merges (built-ins first) and hot-reloads; failures keep the built-ins.
 * Content pages deliberately lag until the next extension update (no fetch).
 */

import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from '../core/constants.js';
import { Logger } from '../storage/logger.js';
import { applyVocabOverride } from '../../shared/retrieval-vocab.js';
import { reloadRetrievalRules } from './api-search.js';

/**
 * 启动装载词表覆盖（幂等；无覆盖/校验失败均静默保持当前生效词表）。
 * Load the vocab override at boot (idempotent; failures keep current vocab).
 * @returns {Promise<{applied: boolean, errors?: string[]}>}
 */
export async function ensureRetrievalVocabOverride() {
  try {
    const stored = await dataStore.readModule(DB_KEYS.RETRIEVAL_VOCAB_OVERRIDE);
    if (!stored || typeof stored !== 'object') return { applied: false };
    const errors = applyVocabOverride(stored);
    if (errors.length > 0) {
      Logger.warn('RetrievalVocab', `词表覆盖校验失败（保持内置词表）: ${errors.slice(0, 3).join('; ')}`);
      return { applied: false, errors };
    }
    reloadRetrievalRules();
    Logger.info('RetrievalVocab', '词表覆盖已生效（规则包下发，内置词表在前追加合并）');
    return { applied: true };
  } catch (e) {
    Logger.warn('RetrievalVocab', `词表覆盖读取失败（保持内置词表）: ${String(e).slice(0, 120)}`);
    return { applied: false, errors: [String(e)] };
  }
}
