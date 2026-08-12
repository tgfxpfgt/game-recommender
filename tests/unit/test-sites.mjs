import { test, expect } from 'vitest';
/**
 * Game Recommender - 测试：下载站详情页元信息提取 / Detail-Meta Extraction
 *
 * v4.2.0：extractDetailMeta（更新日期/版本/大小/百度网盘链接与提取码），
 * 覆盖 sites/search.js 的 HTML 解析纯函数（fixture HTML 驱动）。
 */
'use strict';


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
test('更新日期', () => { expect(meta.updateDate).toEqual('2026-08-10'); });
test('版本号', () => { expect(meta.version).toEqual('V1.2.3'); });
test('大小', () => { expect(meta.size).toEqual('25.4GB'); });
test('百度网盘链接', () => { expect(meta.panUrl).toEqual('https://pan.baidu.com/s/1AbCdEfGhIjK'); });
test('提取码', () => { expect(meta.panCode).toEqual('abcd'); });

console.log('2. 边界与防御');
test('空 HTML 返回空元信息', () => { expect(JSON.stringify(extractDetailMeta('', 'gamer520'))).toEqual(JSON.stringify({ updateDate: '', version: '', size: '', panUrl: '', panCode: '' })); });
test('null HTML 返回空元信息', () => { expect(extractDetailMeta(null, 'gamer520').updateDate).toEqual(''); });
test('无网盘链接时 panUrl 为空', () => { expect(extractDetailMeta('<html><body>无内容</body></html>', 'gamer520').panUrl).toEqual(''); });
// 日期变体（斜杠分隔 + 全角冒号；版本标签支持"游戏版本/版本号"）
const variantHtml = '<html><body><h1>X</h1>更新时间：2026/08/01 游戏版本：1.0 大小：5.2 GB</body></html>';
const variant = extractDetailMeta(variantHtml, 'xdgame');
test('斜杠日期变体', () => { expect(variant.updateDate).toEqual('2026/08/01'); });
test('全角冒号版本变体', () => { expect(variant.version).toEqual('1.0'); });

