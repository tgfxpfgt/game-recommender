/**
 * Game Recommender - 测试：安全与工具 / Security & Utility Tests
 *
 * v4.2.0：SSRF 校验（isSafeFetchUrl）、ND-JSON 编解码、regexExecAll、
 * 缓存 TTL 解析、中英文名异常谓词。静态扫描节（TDZ/语法/manifest/双源）
 * 已并入 integration/test-integrity.mjs；findVersionVariant 并入
 * unit/test-api-pure.mjs。
 */
'use strict';

import { createReporter } from '../helpers/assert.mjs';
const reporter = createReporter();
const { check } = reporter;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// 1. SSRF 校验（加载真实 utils 模块）
const utils = await import(new URL('../../background/core/utils.js', import.meta.url).href + '?t=' + Date.now());
console.log('1. SSRF 校验 isSafeFetchUrl');
check('https 公网', utils.isSafeFetchUrl('https://store.steampowered.com/app/1/'), true);
check('http 公网', utils.isSafeFetchUrl('http://xdgame.com/'), true);
check('localhost 拒绝', utils.isSafeFetchUrl('http://localhost:11434/'), false);
check('127.0.0.1 拒绝', utils.isSafeFetchUrl('http://127.0.0.1/x'), false);
check('10.x 私有拒绝', utils.isSafeFetchUrl('http://10.0.0.1/'), false);
check('192.168 私有拒绝', utils.isSafeFetchUrl('http://192.168.1.1/'), false);
check('172.16 私有拒绝', utils.isSafeFetchUrl('http://172.16.0.1/'), false);
check('js 协议拒绝', utils.isSafeFetchUrl('javascript:alert(1)'), false);
check('非字符串拒绝', utils.isSafeFetchUrl(123), false);
// v3.4.1：SSRF 加固用例（尾点域名 / IPv6 / 编码变体）
check('尾点 localhost. 拒绝', utils.isSafeFetchUrl('http://localhost.:8080/'), false);
check('尾点 127.0.0.1. 拒绝', utils.isSafeFetchUrl('http://127.0.0.1.:8080/'), false);
check('IPv4 八进制变体拒绝', utils.isSafeFetchUrl('http://0177.0.0.1:8080/'), false);
check('IPv4 十六进制变体拒绝', utils.isSafeFetchUrl('http://0x7f000001/'), false);
check('IPv4 单整数变体拒绝', utils.isSafeFetchUrl('http://2130706433/'), false);
check('IPv6 环回 ::1 拒绝', utils.isSafeFetchUrl('http://[::1]/'), false);
check('IPv6 长格式环回拒绝', utils.isSafeFetchUrl('http://[0:0:0:0:0:0:0:1]/'), false);
check('IPv6 未指定 :: 拒绝', utils.isSafeFetchUrl('http://[::]/'), false);
check('IPv6 ULA fd00::/8 拒绝', utils.isSafeFetchUrl('http://[fd00::1]/'), false);
check('IPv6 链路本地 fe80::/10 拒绝', utils.isSafeFetchUrl('http://[fe80::1]/'), false);
check('IPv6 链路本地带 zone 拒绝', utils.isSafeFetchUrl('http://[fe80::1%25eth0]/'), false);
check('IPv6 6to4 嵌入 127.0.0.1 拒绝', utils.isSafeFetchUrl('http://[2002:7f00:1::]/'), false);
check('IPv6 Teredo 拒绝', utils.isSafeFetchUrl('http://[2001:0:0:1::1]/'), false);
check('IPv6 v4-mapped 127.0.0.1 拒绝', utils.isSafeFetchUrl('http://[::ffff:127.0.0.1]/'), false);
check('IPv6 v4-mapped 公网放行', utils.isSafeFetchUrl('http://[::ffff:8.8.8.8]/'), true);
check('IPv6 组播 ff02 拒绝', utils.isSafeFetchUrl('http://[ff02::1]/'), false);
check('IPv6 公网放行', utils.isSafeFetchUrl('http://[2606:4700:4700::1111]/'), true);
check('IPv6 文档段放行', utils.isSafeFetchUrl('http://[2001:db8::1]/'), true);

// 2. ND-JSON 编解码（加载真实 ndjson 模块）
const ndjson = await import(new URL('../../lib/ndjson.js', import.meta.url).href + '?t=' + Date.now());
console.log('2. ND-JSON 编解码');
const entries = [{ a: 1 }, { b: '中文' }, { c: [1, 2] }];
const encoded = ndjson.NDJSON.encode(entries);
check('编码行数', encoded.split('\n').length, 3);
check('解码还原', ndjson.NDJSON.decode(encoded), entries);
check('损坏行跳过', ndjson.NDJSON.decode('{bad}\n{"ok":1}\n').length, 1);
check('空输入', ndjson.NDJSON.decode(''), []);

// 2.5 regexExecAll（Symbol.matchAll 标准符号，v3.2.5 修复）
console.log('2.5 regexExecAll');
check('迭代提取', utils.regexExecAll('a1 b22 c333', /\d+/g).map(m => m[0]), ['1', '22', '333']);
check('自动补 g 标志', utils.regexExecAll('a1 b2', /\d+/).length, 2);
check('无匹配返回空', utils.regexExecAll('abc', /\d+/g).length, 0);

// 3. TDZ 静态扫描（全部 JS 文件）
console.log('6. 缓存 TTL 单位解析');
const constants = await import(new URL('../../background/core/constants.js', import.meta.url).href + '?t=' + Date.now());
check('24 小时 → 24h', constants.resolveTtlMs('steamDynamic', { value: 24, unit: 'hours' }), 24 * 3600e3);
check('30 天 → 30d', constants.resolveTtlMs('registryConfirm', { value: 30, unit: 'days' }), 30 * 86400e3);
check('1 月 → 30d', constants.resolveTtlMs('steamDynamic', { value: 1, unit: 'months' }), 30 * 86400e3);
check('1 年 → 365d', constants.resolveTtlMs('negativeCache', { value: 1, unit: 'years' }), 365 * 86400e3);
check('0 = 长期 Infinity', constants.resolveTtlMs('steamDynamic', { value: 0, unit: 'days' }) === Infinity, true);
check('旧数字格式兼容（steamDynamic=小时）', constants.resolveTtlMs('steamDynamic', 24), 24 * 3600e3);
check('旧数字格式兼容（registryConfirm=天）', constants.resolveTtlMs('registryConfirm', 30), 30 * 86400e3);
check('缺省值', constants.resolveTtlMs('steamDynamic', null), 24 * 3600e3);

// 7. 中英文名异常检测（导入 utils.js 真实谓词，不再复制被测逻辑）
console.log('7. 中英文名异常检测（utils.js 真实谓词）');
const utilsMod = await import(new URL('../../background/core/utils.js', import.meta.url).href);
const validEn = (enName) => !enName || utilsMod.hasLatinLetters(enName, 2);
const validCn = (cnName) => !cnName || utilsMod.hasChineseChars(cnName);
check('正常英文名', validEn('Worship Demon'), true);
check('英文名中文占位异常', validEn('奉魔'), false);
check('混合名含英文', validEn('Demeo x Dungeons'), true);
check('正常中文名', validCn('奉魔'), true);
check('中文名英文占位异常', validCn('Worship Demon'), false);
check('中文名空值', validCn(''), true);

// 8. 版本后缀补搜（v4.1.1：封面旧版 + 标题"增强版" → 升级新版；mock 网络）

console.log('\n===== 安全与工具测试结果 =====');
const finalResult = reporter.getResult();
console.log(finalResult.pass + ' 通过, ' + finalResult.fail + ' 失败');
export const testResult = reporter.getResult();
