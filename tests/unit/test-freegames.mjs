import { test, expect } from 'vitest';
/**
 * Game Recommender - 测试：限免平台分类 / Free-Games Classification Tests
 *
 * v4.2.0：classifyGamerPowerGiveaway（官方直领 vs 第三方 key 领取）与
 * extractThirdPartySource（来源识别）——v4.1.0 起已导出纯函数。
 */
'use strict';


const mod = await import(new URL('../../background/freegames/manager.js', import.meta.url).href + '?t=' + Date.now());
const { classifyGamerPowerGiveaway, extractThirdPartySource } = mod;

console.log('1. 官方直领 vs 第三方（classifyGamerPowerGiveaway）');
test('无 key 标记 → direct', () => { expect(classifyGamerPowerGiveaway({ title: '某游戏', instructions: '登录 Epic 领取' })).toEqual('direct'); });
test('标题含 key → thirdparty', () => { expect(classifyGamerPowerGiveaway({ title: 'Free Game Key', instructions: '' })).toEqual('thirdparty'); });
test('instructions 含 alienware → thirdparty', () => { expect(classifyGamerPowerGiveaway({ title: 'X', instructions: 'Get your key at Alienware Arena' })).toEqual('thirdparty'); });
test('instructions 含 redeem your key → thirdparty', () => { expect(classifyGamerPowerGiveaway({ title: 'X', instructions: 'Redeem your key on Steam' })).toEqual('thirdparty'); });
test('instructions 含 humble bundle → thirdparty', () => { expect(classifyGamerPowerGiveaway({ title: 'X', instructions: 'Claim on Humble Bundle' })).toEqual('thirdparty'); });
test('instructions 含 fanatical → thirdparty', () => { expect(classifyGamerPowerGiveaway({ title: 'X', instructions: 'Your free key at Fanatical' })).toEqual('thirdparty'); });
test('空对象 → direct', () => { expect(classifyGamerPowerGiveaway({})).toEqual('direct'); });
test('大小写不敏感', () => { expect(classifyGamerPowerGiveaway({ title: 'FREE GAME KEY', instructions: '' })).toEqual('thirdparty'); });

console.log('2. 第三方来源识别（extractThirdPartySource）');
test('alienware → Alienware Arena', () => { expect(extractThirdPartySource({ instructions: 'claim at Alienware' })).toEqual('Alienware Arena'); });
test('indiegala → IndieGala', () => { expect(extractThirdPartySource({ instructions: 'get key at IndieGala' })).toEqual('IndieGala'); });
test('humble → Humble Bundle', () => { expect(extractThirdPartySource({ instructions: 'redeem on humble bundle' })).toEqual('Humble Bundle'); });
test('fanatical → Fanatical', () => { expect(extractThirdPartySource({ instructions: 'key via Fanatical' })).toEqual('Fanatical'); });
test('未知来源 → 第三方平台', () => { expect(extractThirdPartySource({ instructions: 'something else' })).toEqual('第三方平台'); });
test('无 instructions → 第三方平台', () => { expect(extractThirdPartySource({})).toEqual('第三方平台'); });

