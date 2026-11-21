/**
 * 游戏雷达 Game Radar - 模块分级建议生成器 / Module-Tiers Suggestion Generator
 *
 * v14.40.0（用户指令 3 扩展：分级根据真实使用日志自动统计更新）——读后台
 * usage.* 计数（feature-usage.js 埋点 → GET_RUNTIME_METRICS 快照），与
 * docs/module-tiers.md 现表对比，输出调级**建议**（只建议不自动改表：T 级
 * 投入变化是人工决策，CHANGELOG 纪律要求可追溯）。
 *
 * 数据源（按可用性自动选择）：
 *   1. scripts/module-tiers-usage.json（本地 dump——e2e-probe 或手动导出，
 *      形态 = { counters: { "usage.view_list": n, ... }, sampledAt: iso })
 *   2. --live：起临时 SW 环境读真机快照（开发中扩展装载时）
 *
 * 用法：
 *   node scripts/gen-module-tiers.mjs                 # 用 dump（无则提示）
 *   node scripts/gen-module-tiers.mjs --dump <file>   # 指定 dump
 *   node scripts/gen-module-tiers.mjs --min 10        # 建议阈值（样本 ≥10 才出建议）
 *
 * 阈值口径（样本 = 会话累计计数；跨版本聚合由用户定期 dump）：
 *   T2→T1 候选：近周期计数 ≥ T1 门槛（默认 50）且无冻结理由
 *   T1→T2 候选：样本 ≥ min 且计数 == 0（整周期零使用）
 *   T0/T1 降级建议一律标注"需人工核对故障面"（T0 降级看故障面不看频率）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const _TIERS_DOC = path.join(ROOT, 'docs/module-tiers.md'); // 台账路径（--write 模式未来消费；现只建议不改表）
const DEFAULT_DUMP = path.join(ROOT, 'scripts/module-tiers-usage.json');

// usage 键 → 台账行（feature-usage.js USAGE_KEYS 同名；台账用域描述）
const FEATURE_DOMAINS = [
  { key: 'usage.view_list', tier: 'T0', label: '列表页评分管线（tracker+badges+list-batch）' },
  { key: 'usage.view_detail', tier: 'T0', label: '详情浮窗（sidebar/detail-templates）' },
  { key: 'usage.click_detail', tier: 'T0', label: '详情点击链（tracking/download-history）' },
  { key: 'usage.click_download', tier: 'T0', label: '下载计数链（app-stats+history）' },
  { key: 'usage.steam_tags_update', tier: 'T1', label: 'Steam 标签回写（画像闭环）' },
  { key: 'usage.dislike_game', tier: 'T1', label: '负反馈（推荐信号）' },
  { key: 'usage.page_popup', tier: 'T1', label: 'popup 页' },
  { key: 'usage.page_options', tier: 'T1', label: 'options 设置页' },
  { key: 'usage.page_dashboard', tier: 'T1', label: 'dashboard 统计页' },
  { key: 'usage.page_freegames', tier: 'T1', label: 'freegames 限免页' },
  { key: 'usage.page_sidepanel', tier: 'T1', label: 'sidepanel 侧栏' },
  { key: 'usage.page_welcome', tier: 'T2', label: 'welcome 引导页' },
  { key: 'usage.page_hub', tier: 'T2', label: 'hub 中心页' },
  { key: 'usage.qr_unlock', tier: 'T2', label: '二维码转链接' },
  { key: 'usage.xdgrid_open', tier: 'T1', label: '列表布局面板' },
  { key: 'usage.backup_create', tier: 'T2', label: '备份创建' },
  { key: 'usage.backup_restore', tier: 'T2', label: '备份恢复' },
  { key: 'usage.data_export', tier: 'T2', label: '数据导出' },
  { key: 'usage.data_import', tier: 'T2', label: '数据导入' },
  { key: 'usage.steam_page_panel', tier: 'T1', label: 'Steam 页检索浮窗' }
];

function readDump(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return j && j.counters ? j : null;
  } catch {
    return null;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const minIdx = argv.indexOf('--min');
  const min = minIdx >= 0 ? Number(argv[minIdx + 1]) || 10 : 10;
  const dumpIdx = argv.indexOf('--dump');
  const dumpFile = dumpIdx >= 0 ? path.resolve(argv[dumpIdx + 1]) : DEFAULT_DUMP;
  const dump = readDump(dumpFile);

  if (!dump) {
    console.log(`[module-tiers] 未找到使用统计 dump：${dumpFile}`);
    console.log('  获取方式（二选一）：');
    console.log('  1) 装载扩展日常使用一段时间后，diagnostics 面板导出 GET_RUNTIME_METRICS 快照，');
    console.log('     存为 scripts/module-tiers-usage.json（形态 { counters: {...}, sampledAt }）');
    console.log('  2) node tests/e2e-probe.mjs --dump-metrics（输出即此形态）');
    process.exit(0);
  }

  const counters = dump.counters || {};
  const total = FEATURE_DOMAINS.reduce((s, f) => s + (counters[f.key] || 0), 0);
  console.log(`[module-tiers] 使用统计（采样 ${dump.sampledAt || '未知时间'}，总事件 ${total}）\n`);

  /** @type {string[]} */
  const suggestions = [];
  for (const f of FEATURE_DOMAINS) {
    const n = counters[f.key] || 0;
    const status = n === 0 ? '零使用' : String(n);
    if (n === 0 && total >= min && f.tier !== 'T3') {
      suggestions.push(
        `  ↓ ${f.label}（现 ${f.tier}）整周期零使用 → 建议降 ${f.tier === 'T0' ? 'T1（需人工核对故障面）' : 'T2'}`
      );
    } else if (n >= 50 && f.tier === 'T2') {
      suggestions.push(`  ↑ ${f.label}（现 T2）计数 ${n} ≥ 50 → 建议升 T1`);
    }
    console.log(`  ${f.key.padEnd(26)} ${status.padEnd(8)} 现级 ${f.tier}`);
  }

  console.log('\n=== 调级建议（人工裁决后改 docs/module-tiers.md + CHANGELOG 记一行） ===');
  if (suggestions.length === 0) console.log('  （无——现分级与使用面一致）');
  else suggestions.forEach((s) => console.log(s));
}

main();
