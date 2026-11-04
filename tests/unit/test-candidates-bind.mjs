/**
 * 游戏雷达 Game Radar - 测试：N3 手动绑定 AppID 输入解析 / Manual-bind parser tests
 *
 * v14.15.0：parseManualAppIdInput 纯函数——两种合法形态（纯数字 1-10 位 /
 * 商店 URL）+ 拒绝形态（越界位数/夹杂字符/空）。下架游戏无搜索路径时这是
 * 唯一兜底入口（v14.6 调研：storesearch 搜不到已下架游戏）。
 * Pure-parser tests: two accepted forms + rejected shapes.
 */
import { describe, expect, it } from 'vitest';
import { parseManualAppIdInput } from '../../content/detail/candidates.js';

describe('N3 手动绑定 AppID 解析（parseManualAppIdInput）', () => {
  it('纯数字 1-10 位', () => {
    expect(parseManualAppIdInput('1091500')).toEqual('1091500');
    expect(parseManualAppIdInput(' 292030 ')).toEqual('292030');
    expect(parseManualAppIdInput('1')).toEqual('1');
  });
  it('商店 URL 整段粘贴（含路径/查询串噪声）', () => {
    expect(parseManualAppIdInput('https://store.steampowered.com/app/1091500/Cyberpunk_2077/')).toEqual('1091500');
    expect(parseManualAppIdInput('store.steampowered.com/app/292030/?l=schinese')).toEqual('292030');
  });
  it('拒绝形态：空/越界/夹杂', () => {
    expect(parseManualAppIdInput('')).toEqual(null);
    expect(parseManualAppIdInput('   ')).toEqual(null);
    expect(parseManualAppIdInput('12345678901')).toEqual(null); // 11 位越界
    expect(parseManualAppIdInput('abc123')).toEqual(null);
    expect(parseManualAppIdInput('12 34')).toEqual(null);
  });
  it('URL 中的长数字段不误收（路径段优先匹配 app/ 后数字）', () => {
    // 11 位 appId 的 URL → 不匹配 \d{1,10} 内联段 → 返回 null（守卫生效）
    expect(parseManualAppIdInput('https://store.steampowered.com/app/12345678901/x/')).toEqual(null);
  });
});
