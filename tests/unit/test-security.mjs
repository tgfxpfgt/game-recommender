import { test, expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：安全与工具 / Security & Utility Tests
 *
 * v4.2.0：SSRF 校验（isSafeFetchUrl）、ND-JSON 编解码、regexExecAll、
 * 缓存 TTL 解析、中英文名异常谓词。静态扫描节（TDZ/语法/manifest/双源）
 * 已并入 integration/test-integrity.mjs；findVersionVariant 并入
 * unit/test-api-pure.mjs。
 */
'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// 1. SSRF 校验（加载真实 utils 模块）
const utils = await import(new URL('../../background/core/utils.js', import.meta.url).href + '?t=' + Date.now());
test('https 公网', () => { expect(utils.isSafeFetchUrl('https://store.steampowered.com/app/1/')).toEqual(true); });
test('http 公网', () => { expect(utils.isSafeFetchUrl('http://xdgame.com/')).toEqual(true); });
test('localhost 拒绝', () => { expect(utils.isSafeFetchUrl('http://localhost:11434/')).toEqual(false); });
test('127.0.0.1 拒绝', () => { expect(utils.isSafeFetchUrl('http://127.0.0.1/x')).toEqual(false); });
test('10.x 私有拒绝', () => { expect(utils.isSafeFetchUrl('http://10.0.0.1/')).toEqual(false); });
test('192.168 私有拒绝', () => { expect(utils.isSafeFetchUrl('http://192.168.1.1/')).toEqual(false); });
test('172.16 私有拒绝', () => { expect(utils.isSafeFetchUrl('http://172.16.0.1/')).toEqual(false); });
test('js 协议拒绝', () => { expect(utils.isSafeFetchUrl('javascript:alert(1)')).toEqual(false); });
test('非字符串拒绝', () => { expect(utils.isSafeFetchUrl(123)).toEqual(false); });
// v3.4.1：SSRF 加固用例（尾点域名 / IPv6 / 编码变体）
test('尾点 localhost. 拒绝', () => { expect(utils.isSafeFetchUrl('http://localhost.:8080/')).toEqual(false); });
test('尾点 127.0.0.1. 拒绝', () => { expect(utils.isSafeFetchUrl('http://127.0.0.1.:8080/')).toEqual(false); });
test('IPv4 八进制变体拒绝', () => { expect(utils.isSafeFetchUrl('http://0177.0.0.1:8080/')).toEqual(false); });
test('IPv4 十六进制变体拒绝', () => { expect(utils.isSafeFetchUrl('http://0x7f000001/')).toEqual(false); });
test('IPv4 单整数变体拒绝', () => { expect(utils.isSafeFetchUrl('http://2130706433/')).toEqual(false); });
test('IPv6 环回 ::1 拒绝', () => { expect(utils.isSafeFetchUrl('http://[::1]/')).toEqual(false); });
test('IPv6 长格式环回拒绝', () => { expect(utils.isSafeFetchUrl('http://[0:0:0:0:0:0:0:1]/')).toEqual(false); });
test('IPv6 未指定 :: 拒绝', () => { expect(utils.isSafeFetchUrl('http://[::]/')).toEqual(false); });
test('IPv6 ULA fd00::/8 拒绝', () => { expect(utils.isSafeFetchUrl('http://[fd00::1]/')).toEqual(false); });
test('IPv6 链路本地 fe80::/10 拒绝', () => { expect(utils.isSafeFetchUrl('http://[fe80::1]/')).toEqual(false); });
test('IPv6 链路本地带 zone 拒绝', () => { expect(utils.isSafeFetchUrl('http://[fe80::1%25eth0]/')).toEqual(false); });
test('IPv6 6to4 嵌入 127.0.0.1 拒绝', () => { expect(utils.isSafeFetchUrl('http://[2002:7f00:1::]/')).toEqual(false); });
test('IPv6 Teredo 拒绝', () => { expect(utils.isSafeFetchUrl('http://[2001:0:0:1::1]/')).toEqual(false); });
test('IPv6 v4-mapped 127.0.0.1 拒绝', () => { expect(utils.isSafeFetchUrl('http://[::ffff:127.0.0.1]/')).toEqual(false); });
test('IPv6 v4-mapped 公网放行', () => { expect(utils.isSafeFetchUrl('http://[::ffff:8.8.8.8]/')).toEqual(true); });
test('IPv6 组播 ff02 拒绝', () => { expect(utils.isSafeFetchUrl('http://[ff02::1]/')).toEqual(false); });
test('IPv6 公网放行', () => { expect(utils.isSafeFetchUrl('http://[2606:4700:4700::1111]/')).toEqual(true); });
test('IPv6 文档段放行', () => { expect(utils.isSafeFetchUrl('http://[2001:db8::1]/')).toEqual(true); });

// 2. ND-JSON 编解码（加载真实 ndjson 模块）
const ndjson = await import(new URL('../../lib/ndjson.js', import.meta.url).href + '?t=' + Date.now());
const entries = [{ a: 1 }, { b: '中文' }, { c: [1, 2] }];
const encoded = ndjson.NDJSON.encode(entries);
test('编码行数', () => { expect(encoded.split('\n').length).toEqual(3); });
test('解码还原', () => { expect(ndjson.NDJSON.decode(encoded)).toEqual(entries); });
test('损坏行跳过', () => { expect(ndjson.NDJSON.decode('{bad}\n{"ok":1}\n').length).toEqual(1); });
test('空输入', () => { expect(ndjson.NDJSON.decode('')).toEqual([]); });

// 2.5 regexExecAll（Symbol.matchAll 标准符号，v3.2.5 修复）
test('迭代提取', () => { expect(utils.regexExecAll('a1 b22 c333', /\d+/g).map((m) => m[0])).toEqual(['1', '22', '333']); });
test('自动补 g 标志', () => { expect(utils.regexExecAll('a1 b2', /\d+/).length).toEqual(2); });
test('无匹配返回空', () => { expect(utils.regexExecAll('abc', /\d+/g).length).toEqual(0); });

// 3. TDZ 静态扫描（全部 JS 文件）
const constants = await import(
  new URL('../../background/core/constants.js', import.meta.url).href + '?t=' + Date.now()
);
test('24 小时 → 24h', () => { expect(constants.resolveTtlMs('steamDynamic', { value: 24, unit: 'hours' })).toEqual(24 * 3600e3); });
test('30 天 → 30d', () => { expect(constants.resolveTtlMs('registryConfirm', { value: 30, unit: 'days' })).toEqual(30 * 86400e3); });
test('1 月 → 30d', () => { expect(constants.resolveTtlMs('steamDynamic', { value: 1, unit: 'months' })).toEqual(30 * 86400e3); });
test('1 年 → 365d', () => { expect(constants.resolveTtlMs('negativeCache', { value: 1, unit: 'years' })).toEqual(365 * 86400e3); });
test('0 = 长期 Infinity', () => { expect(constants.resolveTtlMs('steamDynamic', { value: 0, unit: 'days' }) === Infinity).toEqual(true); });
test('旧数字格式兼容（steamDynamic=小时）', () => { expect(constants.resolveTtlMs('steamDynamic', 24)).toEqual(24 * 3600e3); });
test('旧数字格式兼容（registryConfirm=天）', () => { expect(constants.resolveTtlMs('registryConfirm', 30)).toEqual(30 * 86400e3); });
test('缺省值', () => { expect(constants.resolveTtlMs('steamDynamic', null)).toEqual(24 * 3600e3); });

// 7. 中英文名异常检测（导入 utils.js 真实谓词，不再复制被测逻辑）
const utilsMod = await import(new URL('../../background/core/utils.js', import.meta.url).href);
const validEn = (enName) => !enName || utilsMod.hasLatinLetters(enName, 2);
const validCn = (cnName) => !cnName || utilsMod.hasChineseChars(cnName);
test('正常英文名', () => { expect(validEn('Worship Demon')).toEqual(true); });
test('英文名中文占位异常', () => { expect(validEn('奉魔')).toEqual(false); });
test('混合名含英文', () => { expect(validEn('Demeo x Dungeons')).toEqual(true); });
test('正常中文名', () => { expect(validCn('奉魔')).toEqual(true); });
test('中文名英文占位异常', () => { expect(validCn('Worship Demon')).toEqual(false); });
test('中文名空值', () => { expect(validCn('')).toEqual(true); });

// 8. 版本后缀补搜（v4.1.1：封面旧版 + 标题"增强版" → 升级新版；mock 网络）

