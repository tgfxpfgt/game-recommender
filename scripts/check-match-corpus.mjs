/**
 * 游戏雷达 Game Radar - 匹配语料分母门禁 / Match Corpus Denominator Gate
 *
 * v14.28.9（E 类缺陷制度性根治：验收无分母）：
 * 回放类套件最容易"假绿"的形态是——样本缺 ground truth（expectedAppId/
 * expectedName 空）、或录制的检索词全为 0 条（回放对空 mock 必然"通过"）、
 * 或用 skipVerify 一把豁免却不写原因。三种形态都会让"准确率"没有分母，
 * 套件红了也说不清是回归还是样本漂移。
 *
 * 本门禁只做**离线静态事实校验**（不发网络），要求每条样本自带可判定的分母，
 * 并把名称级分母覆盖率打印出来（不足只告警不拦——见 note）。
 *
 * Usage: node scripts/check-match-corpus.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 事故/基准语料（wrong-report 为 dashboard 导出的人工入册文件，可缺） */
const SOURCES = [
  { file: 'tests/fixtures/mismatch-samples.json', nameLevel: true },
  { file: 'tests/fixtures/baseline-firstpage.json', nameLevel: false },
  { file: 'tests/fixtures/baseline-xd3.json', nameLevel: false },
  { file: 'tests/fixtures/wrong-report-samples.json', nameLevel: true }
];

const errors = [];
/** @type {Array<{file: string, total: number, labeled: number, named: number, miss: number, skipped: number}>} */
const stats = [];
const seenIds = new Set();

for (const src of SOURCES) {
  const abs = path.join(ROOT, src.file);
  if (!fs.existsSync(abs)) continue; // 可选源缺失不拦（wrong-report 人工入册）
  const doc = JSON.parse(fs.readFileSync(abs, 'utf-8'));
  const samples = Array.isArray(doc.samples) ? doc.samples : [];
  if (samples.length === 0) {
    errors.push(`${src.file}: samples 为空——空语料让回放套件"零样本全绿"，必须有分母`);
    continue;
  }
  const st = { file: src.file, total: samples.length, labeled: 0, named: 0, miss: 0, skipped: 0 };
  samples.forEach((s, i) => {
    const at = `${src.file}#${i}${s && s.id ? `(${s.id})` : ''}`;
    if (!s || typeof s !== 'object') {
      errors.push(`${at}: 样本不是对象`);
      return;
    }
    if (!s.id || typeof s.id !== 'string') errors.push(`${at}: 缺 id（回放结果无法对号）`);
    else if (seenIds.has(s.id)) errors.push(`${at}: id 重复（${s.id}）——回放统计会互相覆盖`);
    else seenIds.add(s.id);
    if (!s.rawTitle || typeof s.rawTitle !== 'string') errors.push(`${at}: 缺 rawTitle（回放输入）`);

    const hasKey = Object.prototype.hasOwnProperty.call(s, 'expectedAppId');
    const appId = s.expectedAppId;
    const isMiss = /miss/i.test(String(s.kind || ''));
    if (!hasKey) {
      errors.push(`${at}: 缺 expectedAppId 字段（未命中请显式写 null + kind:'miss' + note）`);
      return;
    }
    if (appId === null || appId === undefined || appId === '') {
      st.miss++;
      if (!isMiss) errors.push(`${at}: expectedAppId 为空但 kind 未标 miss——"未命中"必须显式声明，否则等于无分母`);
      if (!s.note || !String(s.note).trim()) errors.push(`${at}: 未命中样本缺 note（为什么这次"无结果"是正确答案）`);
    } else {
      st.labeled++;
      if (!/^\d+$/.test(String(appId))) errors.push(`${at}: expectedAppId 非数字串（${String(appId)}）`);
      if (src.nameLevel) {
        if (!s.expectedName || !String(s.expectedName).trim()) {
          errors.push(`${at}: 缺 expectedName——名称级语料必须能验证"配到哪个名字"，只有 appid 无法判名称错配`);
        } else st.named++;
      } else if (s.expectedName && String(s.expectedName).trim()) st.named++;
    }

    if (s.skipVerify === true) {
      st.skipped++;
      if (!s.skipReason || !String(s.skipReason).trim()) {
        errors.push(`${at}: skipVerify 缺 skipReason——豁免必须写明"为什么这条无法判定"`);
      }
      return;
    }
    const terms = Object.keys(s.recorded || {});
    if (terms.length === 0) {
      errors.push(`${at}: 缺 recorded（回放无数据 = 对空 mock 必然通过，假绿）`);
      return;
    }
    if (!isMiss) {
      const anyHit = terms.some((t) => Number((s.recorded[t] || {}).total) > 0);
      if (!anyHit) {
        errors.push(`${at}: recorded 全部 0 命中，却期望命中 ${String(appId)}——该样本无法证明检索能力（真空通过）`);
      }
    }
  });
  stats.push(st);
}

// 名称级分母覆盖率：只报告不拦（基线语料当前为 appid 级 ground truth；
// 若要提升到名称级，需人工补 37 条 expectedName——见报告 E 类残项）。
console.log('语料分母统计（文件 | 总数 | appid 标注 | 名称标注 | 未命中 | 豁免）:');
for (const s of stats) {
  console.log(`  ${s.file} | ${s.total} | ${s.labeled} | ${s.named} | ${s.miss} | ${s.skipped}`);
}
const total = stats.reduce((n, s) => n + s.total, 0);
const named = stats.reduce((n, s) => n + s.named, 0);
if (total > 0 && named === 0) {
  console.warn('⚠️ 名称级分母覆盖率为 0：appid 级回放仍可验证"配到哪个 appid"，但无法验证"匹配到的名字对不对"。');
}

if (errors.length > 0) {
  console.error(`❌ 匹配语料门禁失败（${errors.length} 项）:`);
  for (const e of errors) console.error('   - ' + e);
  process.exit(1);
}
console.log(`✅ 匹配语料分母完整（${total} 条）`);
