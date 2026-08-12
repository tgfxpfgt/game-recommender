/**
 * Game Recommender - 测试：下载站详情页元信息提取 / Detail-Meta Extraction
 *
 * v4.2.0：extractDetailMeta（更新日期/版本/大小/百度网盘链接与提取码），
 * 覆盖 sites/search.js 的 HTML 解析纯函数（fixture HTML 驱动）。
 */
'use strict';

import { createReporter } from '../helpers/assert.mjs';
const reporter = createReporter();
const { check } = reporter;

const mod = await import(new URL('../../background/sites/search.js', import.meta.url).href + '?t=' + Date.now());
const { extractDetailMeta } = mod;

// 典型下载站详情页 HTML（gamer520 风格：h1 + 更新时间/版本/大小 + 百度网盘）
// 注：h1 不含版本号数字（真实页面 h1 常带版本，但版本区才是权威来源）
const FIXTURE_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>测试游戏|官方中文</title></head>
<body>
<h1 class="entry-title">测试游戏增强版|官方中文|解压即撸</h1>
<div class="info">
  更新时间：2026-08-10
  游戏版本：V1.2.3
  游戏大小：25.4GB
  下载地址：https://pan.baidu.com/s/1AbCdEfGhIjK
  提取码：abcd
</div>
</body></html>`;

console.log('1. 完整元信息提取');
const meta = extractDetailMeta(FIXTURE_HTML, 'gamer520');
check('更新日期', meta.updateDate, '2026-08-10');
check('版本号', meta.version, 'V1.2.3');
check('大小', meta.size, '25.4GB');
check('百度网盘链接', meta.panUrl, 'https://pan.baidu.com/s/1AbCdEfGhIjK');
check('提取码', meta.panCode, 'abcd');

console.log('2. 边界与防御');
check('空 HTML 返回空元信息', JSON.stringify(extractDetailMeta('', 'gamer520')), JSON.stringify({ updateDate: '', version: '', size: '', panUrl: '', panCode: '' }));
check('null HTML 返回空元信息', extractDetailMeta(null, 'gamer520').updateDate, '');
check('无网盘链接时 panUrl 为空', extractDetailMeta('<html><body>无内容</body></html>', 'gamer520').panUrl, '');
// 日期变体（斜杠分隔 + 全角冒号；版本标签支持"游戏版本/版本号"）
const variantHtml = '<html><body><h1>X</h1>更新时间：2026/08/01 游戏版本：1.0 大小：5.2 GB</body></html>';
const variant = extractDetailMeta(variantHtml, 'xdgame');
check('斜杠日期变体', variant.updateDate, '2026/08/01');
check('全角冒号版本变体', variant.version, '1.0');

console.log('\n===== 详情页元信息提取测试结果 =====');
const finalResult = reporter.getResult();
console.log(finalResult.pass + ' 通过, ' + finalResult.fail + ' 失败');
export const testResult = reporter.getResult();
