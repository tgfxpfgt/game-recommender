/**
 * 游戏雷达 Game Radar - 页面归类与游戏名提取单测
 * Unit tests for core/page-url.js and detail/detect-name.js (v14.26.0 P1-3).
 */
import { describe, test, expect } from 'vitest';
import { detectPageScope, isDetailPageByUrl, isHomePageUrl, isListPageByUrl } from '../../content/core/page-url.js';
import { detectGameName } from '../../content/detail/detect-name.js';

/** 构造假 h1（cloneNode 返回同构克隆，避免依赖真实 DOM） */
function fakeH1(text, { child = null, imgs = [] } = {}) {
  const node = {
    textContent: text,
    querySelectorAll: () => [],
    querySelector: () => child
  };
  node.cloneNode = () => node;
  node.__imgs = imgs;
  return node;
}

/** 安装最小 document（只提供 detectGameName 用到的接口） */
function setDom({ title = '', h1 = null, imgs = [] } = {}) {
  globalThis.document = {
    title,
    querySelector: (sel) => (sel === 'h1' ? h1 : null),
    querySelectorAll: () => imgs
  };
}

describe('page-url：URL 判定', () => {
  test('详情页/列表页/首页判定', () => {
    expect(isDetailPageByUrl('/123.html')).toBe(true);
    expect(isDetailPageByUrl('/game/456.shtml')).toBe(true);
    expect(isDetailPageByUrl('/game/789/')).toBe(false); // 分类页不是详情页
    expect(isListPageByUrl('/')).toBe(true);
    expect(isListPageByUrl('/list/action')).toBe(true);
    expect(isListPageByUrl('/page/2')).toBe(true);
    expect(isListPageByUrl('/123.html')).toBe(false); // 详情页优先
    expect(isHomePageUrl('/', '')).toBe(true);
    expect(isHomePageUrl('/index.html', '')).toBe(true);
    expect(isHomePageUrl('/', '?s=zelda')).toBe(false); // 带查询串按列表页处理
  });

  test('detectPageScope：Steam/steam250 → detail，下载站按 URL 分流，未知站 → both', () => {
    expect(detectPageScope('store.steampowered.com', '/app/730', '')).toBe('detail');
    expect(detectPageScope('club.steam250.com', '/app/730', '')).toBe('detail');
    expect(detectPageScope('dl.example.com', '/123.html', '')).toBe('detail');
    expect(detectPageScope('dl.example.com', '/', '')).toBe('list');
    expect(detectPageScope('dl.example.com', '/list/action', '')).toBe('list');
    expect(detectPageScope('dl.example.com', '/special/landing', '')).toBe('both');
  });
});

describe('detect-name：详情页游戏名提取', () => {
  test('汇总/索引页 → 空串（跳过详情处理）', () => {
    setDom({ title: '资源索引', h1: fakeH1('2024 游戏汇总贴') });
    expect(detectGameName()).toBe('');
  });

  test('h1 子元素为纯英文 → 直接采用英文名', () => {
    setDom({ title: '某站', h1: fakeH1('中文标题', { child: { textContent: 'Hollow Knight' } }) });
    expect(detectGameName()).toBe('Hollow Knight');
  });

  test('分段清理噪声词 → 丢弃纯噪声段、保留游戏名', () => {
    setDom({ title: '某站', h1: fakeH1('Hollow Knight | 中文版 | 免安装绿色版') });
    expect(detectGameName()).toBe('Hollow Knight');
  });

  test('纯中文名 → 回退 Steam 图片 alt 的英文名', () => {
    const img = { getAttribute: () => 'Zelda on Steam' };
    setDom({ title: '某站', h1: fakeH1('塞尔达传说'), imgs: [img] });
    expect(detectGameName()).toBe('Zelda');
  });

  test('无 h1 → 回退清理后的 document.title', () => {
    setDom({ title: 'Hades 中文版 下载' });
    expect(detectGameName()).toContain('Hades');
  });
});
