/**
 * Game Recommender - 测试：限免平台分类 / Free-Games Classification Tests
 *
 * v4.2.0：classifyGamerPowerGiveaway（官方直领 vs 第三方 key 领取）与
 * extractThirdPartySource（来源识别）——v4.1.0 起已导出纯函数。
 */
'use strict';

import { createReporter } from '../helpers/assert.mjs';
const reporter = createReporter();
const { check } = reporter;

const mod = await import(new URL('../../background/freegames/manager.js', import.meta.url).href + '?t=' + Date.now());
const { classifyGamerPowerGiveaway, extractThirdPartySource } = mod;

console.log('1. 官方直领 vs 第三方（classifyGamerPowerGiveaway）');
check(
  '无 key 标记 → direct',
  classifyGamerPowerGiveaway({ title: '某游戏', instructions: '登录 Epic 领取' }),
  'direct'
);
check(
  '标题含 key → thirdparty',
  classifyGamerPowerGiveaway({ title: 'Free Game Key', instructions: '' }),
  'thirdparty'
);
check(
  'instructions 含 alienware → thirdparty',
  classifyGamerPowerGiveaway({ title: 'X', instructions: 'Get your key at Alienware Arena' }),
  'thirdparty'
);
check(
  'instructions 含 redeem your key → thirdparty',
  classifyGamerPowerGiveaway({ title: 'X', instructions: 'Redeem your key on Steam' }),
  'thirdparty'
);
check(
  'instructions 含 humble bundle → thirdparty',
  classifyGamerPowerGiveaway({ title: 'X', instructions: 'Claim on Humble Bundle' }),
  'thirdparty'
);
check(
  'instructions 含 fanatical → thirdparty',
  classifyGamerPowerGiveaway({ title: 'X', instructions: 'Your free key at Fanatical' }),
  'thirdparty'
);
check('空对象 → direct', classifyGamerPowerGiveaway({}), 'direct');
check('大小写不敏感', classifyGamerPowerGiveaway({ title: 'FREE GAME KEY', instructions: '' }), 'thirdparty');

console.log('2. 第三方来源识别（extractThirdPartySource）');
check(
  'alienware → Alienware Arena',
  extractThirdPartySource({ instructions: 'claim at Alienware' }),
  'Alienware Arena'
);
check('indiegala → IndieGala', extractThirdPartySource({ instructions: 'get key at IndieGala' }), 'IndieGala');
check('humble → Humble Bundle', extractThirdPartySource({ instructions: 'redeem on humble bundle' }), 'Humble Bundle');
check('fanatical → Fanatical', extractThirdPartySource({ instructions: 'key via Fanatical' }), 'Fanatical');
check('未知来源 → 第三方平台', extractThirdPartySource({ instructions: 'something else' }), '第三方平台');
check('无 instructions → 第三方平台', extractThirdPartySource({}), '第三方平台');

console.log('\n===== 限免平台分类测试结果 =====');
const finalResult = reporter.getResult();
console.log(finalResult.pass + ' 通过, ' + finalResult.fail + ' 失败');
export const testResult = reporter.getResult();
