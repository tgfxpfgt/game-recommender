/**
 * 游戏雷达 Game Radar - 测试开销历史与异常发现 / Test Cost History & Anomaly Detection
 *
 * v14.28.11（用户指令 2026-11-12：测试开销要有记录，异常能及时发现）：
 * 墙钟预算（scripts/suite-budgets.json）是**静态 cap**——只拦"超过实测基线 1.5×"
 * 的突发，拦不住"每次都在 cap 内、但比近期典型慢 40%"的缓慢漂移（基线只在
 * 人工测量时更新）。本模块把 gate 每步骤耗时追加到 scripts/.gate-costs.jsonl
 * （gitignored，本机数据不入库），运行结束对固定口径步骤做**滚动中位数对比**
 * 并输出 ⚠️ 异常告警（只告警不判红——定性由人做：先隔离复跑排环境负载，
 * 再决定复跑或重测基线；阈值 1.5× 与预算纪律同源）。
 * Wall-clock budgets are static caps; this module records per-step cost history
 * (local, gitignored) and flags steps whose cost exceeds 1.5× the rolling
 * median of recent clean runs — catching slow drift the static cap misses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY_PATH = path.join(ROOT, 'scripts', '.gate-costs.jsonl');

// 异常判定参数（单源；与 suite-budgets 的 cap=实测×1.5 同一倍率语义）
export const ANOMALY_RATIO = 1.5;
export const MIN_SAMPLES = 5; // 少于 5 次历史不做判定（样本不足）
export const MIN_MEDIAN_MS = 10000; // 中位数 <10s 的步骤噪声占比高，不判定

/** @param {number[]} nums */
export function median(nums) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * 读历史（容忍损坏行——jsonl 手工编辑/进程中断都可能出现半行）。
 * @param {string} [filePath] 可注入路径（测试用）；默认仓库内 gitignored 历史文件
 * @returns {Array<{ts: number, mode: string, step: string, ms: number, code: number}>}
 */
export function readCostHistory(filePath = HISTORY_PATH) {
  try {
    return fs
      .readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return []; // 损坏行跳过，不中断报告
        }
      });
  } catch {
    return []; // 无历史文件 = 首次运行
  }
}

/**
 * 步骤开销异常判定（纯函数）。
 * @param {string} step 步骤名
 * @param {number} ms 本次耗时
 * @param {Array<{step: string, ms: number, code: number}>} entries 历史条目
 * @returns {{analyzable: boolean, medianMs: number, anomaly: boolean, ratio: number}}
 *   analyzable=false：样本不足 / 中位数低于噪声下限 / 全部历史为失败运行
 */
export function analyzeStepCost(step, ms, entries) {
  const clean = entries.filter((e) => e.step === step && e.code === 0 && Number.isFinite(e.ms)).slice(-10);
  if (clean.length < MIN_SAMPLES) {
    return { analyzable: false, medianMs: 0, anomaly: false, ratio: 0 };
  }
  const medianMs = median(clean.map((e) => e.ms));
  if (medianMs < MIN_MEDIAN_MS) {
    return { analyzable: false, medianMs, anomaly: false, ratio: 0 };
  }
  const ratio = medianMs > 0 ? ms / medianMs : 0;
  return { analyzable: true, medianMs, anomaly: ratio > ANOMALY_RATIO, ratio };
}

/**
 * 追加一条记录（best-effort——历史记录失败绝不阻塞门禁）。
 * @param {string} mode 'fast' | 'full' | 'total'
 * @param {string} step
 * @param {number} ms
 * @param {number} code
 * @param {string} [filePath] 可注入路径（测试用）
 */
export function recordStepCost(mode, step, ms, code, filePath = HISTORY_PATH) {
  try {
    fs.appendFileSync(filePath, JSON.stringify({ ts: Date.now(), mode, step, ms, code }) + '\n');
  } catch {
    /* 历史记录是增强诊断，不是门禁语义——失败静默 */
  }
}

/**
 * gate 收尾汇总：对本次各步骤打印 ⚠️ 开销异常（与近期干净运行的中位数比）。
 * @param {string} mode 'fast' | 'full'
 * @param {Array<{step: string, ms: number, code: number}>} currentRuns 本次运行的步骤记录
 * @param {Set<string>} [skipSteps] 不参与异常判定的变口径步骤（如 fast 的 vitest 受影响选择——耗时随变更面变化，历史中位数无语义）
 * @param {string} [filePath]
 */
export function reportCostAnomalies(mode, currentRuns, skipSteps = new Set(), filePath = HISTORY_PATH) {
  const history = readCostHistory(filePath);
  if (history.length === 0) return; // 首次运行无基线
  const lines = [];
  for (const run of currentRuns) {
    if (skipSteps.has(run.step)) continue;
    const a = analyzeStepCost(run.step, run.ms, history);
    if (a.analyzable && a.anomaly) {
      lines.push(
        `  ⚠️ ${run.step}：${(run.ms / 1000).toFixed(1)}s，为近期中位数 ${(a.medianMs / 1000).toFixed(1)}s 的 ${a.ratio.toFixed(2)}×（>${ANOMALY_RATIO}×）——先隔离复跑排环境负载，再查是否套件膨胀或需重测基线`
      );
    }
  }
  if (lines.length > 0) {
    console.log(`\n📊 测试开销异常（历史 ${history.length} 条，scripts/.gate-costs.jsonl）:`);
    for (const l of lines) console.log(l);
  }
}
