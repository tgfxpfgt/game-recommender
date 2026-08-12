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
  const failures = []; // v4.1.2：失败明细（run-tests.js 汇总输出）
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) {
      pass++;
      console.log('  ✅', name);
    } else {
      fail++;
      failures.push({ name, actual, expected });
      console.log('  ❌', name, '→ 实际:', JSON.stringify(actual), '期望:', JSON.stringify(expected));
    }
  };
  // v4.2.0：断言函数抛错（pattern 为正则/子串，缺省只要抛即可）
  const assertThrows = (name, fn, pattern) => {
    let threw = false;
    let message = '';
    try {
      fn();
    } catch (e) {
      threw = true;
      message = e && e.message ? e.message : String(e);
    }
    const ok = threw && (!pattern || (pattern.test ? pattern.test(message) : message.includes(pattern)));
    if (ok) {
      pass++;
      console.log('  ✅', name);
    } else {
      fail++;
      const detail = threw ? `（抛了但消息不匹配: ${message}）` : '（未抛错）';
      failures.push({ name, actual: threw ? message : 'no-throw', expected: String(pattern || 'throws') });
      console.log('  ❌', name, detail);
    }
  };
  // v4.2.0：异步断言（fn 为 async，实际值与期望深比较）
  const assertAsync = async (name, fn, expected) => {
    let actual;
    let err = null;
    try {
      actual = await fn();
    } catch (e) {
      err = e;
    }
    const ok = !err && JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) {
      pass++;
      console.log('  ✅', name);
    } else {
      fail++;
      failures.push({ name, actual: err ? 'THREW: ' + err.message : actual, expected });
      console.log(
        '  ❌',
        name,
        err ? `→ 抛错: ${err.message}` : `→ 实际: ${JSON.stringify(actual)} 期望: ${JSON.stringify(expected)}`
      );
    }
  };
  const getResult = () => ({ pass, fail, ok: fail === 0, failures });
  return { check, assertThrows, assertAsync, getResult };
}
