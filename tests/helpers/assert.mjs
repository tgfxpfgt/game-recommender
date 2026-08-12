/**
 * Game Recommender - 测试断言共享助手 / Shared Test Assertions
 *
 * v4.1.0：9 个测试文件此前各自复制同一份 check()/pass/fail 实现，
 * 统一抽取至此。行为与旧实现完全一致（JSON.stringify 深比较）。
 * createReporter() → { check(name, actual, expected), getResult() }
 * Unified check()/counter extraction (was duplicated across 9 test files);
 * behavior identical to the old implementation (JSON deep compare).
 */
'use strict';

export function createReporter() {
  let pass = 0;
  let fail = 0;
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { pass++; console.log('  ✅', name); }
    else { fail++; console.log('  ❌', name, '→ 实际:', JSON.stringify(actual), '期望:', JSON.stringify(expected)); }
  };
  const getResult = () => ({ pass, fail, ok: fail === 0 });
  return { check, getResult };
}
