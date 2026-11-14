import { describe, expect, it } from 'vitest';
import { detectPlatform } from './platforms.js';

describe('detectPlatform', () => {
  it('模拟器优先于主机（模拟器整合 = ROM 包）', () => {
    expect(detectPlatform('塞尔达传说|模拟器整合')).toEqual({ platform: 'emulator', tag: '模拟器' });
  });
  it('主机整段命中（含迭代剥后缀）', () => {
    expect(detectPlatform('王国之泪|Switch整合版')?.platform).toEqual('console');
    expect(detectPlatform('主机游戏移植版')?.platform).toEqual('console');
  });
  it('裸移植段命中主机（v14.31 词表语义保留）', () => {
    expect(detectPlatform('大镖客|移植版')?.platform).toEqual('console');
  });
  it('PC 显式标记优先（PC移植版 = 主机→PC 移植，Steam 有数据）', () => {
    expect(detectPlatform('艾尔登法环|PC移植版')).toEqual(null);
    expect(detectPlatform('GTA5|PC版')).toEqual(null);
  });
  it('游戏名内含标记词不误判（PC装机模拟器）', () => {
    expect(detectPlatform('PC装机模拟器')).toEqual(null);
  });
  it('纯 PC 标题 → null（走 Steam 常规管线）', () => {
    expect(detectPlatform('赛博朋克2077|官方中文')).toEqual(null);
  });
});
