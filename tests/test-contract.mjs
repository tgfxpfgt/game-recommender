/**
 * Game Recommender - 测试：消息契约校验 / Message Contract Tests
 *
 * v4.0.0：验证 validateMessage 对 9 个高风险 action 的入参校验
 * （白名单 type、必填字段、数字 appId、类型约束），未契约化 action 放行。
 * Verifies validateMessage for the 9 high-risk actions (type whitelist,
 * required fields, numeric appId, type constraints); uncovered actions pass.
 */
'use strict';

const mod = await import(new URL('../background/core/message-contract.js', import.meta.url).href + '?t=' + Date.now());
const { validateMessage } = mod;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, '→ 实际:', JSON.stringify(actual), '期望:', JSON.stringify(expected)); }
}

console.log('1. TRACK_EVENT（type 白名单 + gameName 必填）');
check('合法 view_detail', validateMessage('TRACK_EVENT', { data: { type: 'view_detail', gameName: '游戏A' } }).ok, true);
check('合法 view_list（无 gameName）', validateMessage('TRACK_EVENT', { data: { type: 'view_list', itemCount: 5 } }).ok, true);
check('合法 steam_tags_update（keywords 数组）', validateMessage('TRACK_EVENT', { data: { type: 'steam_tags_update', gameName: '游戏B', keywords: ['RPG'] } }).ok, true);
check('未知 type 拒绝', validateMessage('TRACK_EVENT', { data: { type: 'hack' } }).ok, false);
check('view_detail 缺 gameName 拒绝', validateMessage('TRACK_EVENT', { data: { type: 'view_detail' } }).ok, false);
check('gameName 超 200 拒绝', validateMessage('TRACK_EVENT', { data: { type: 'click_detail', gameName: 'x'.repeat(201) } }).ok, false);
check('keywords 非数组拒绝', validateMessage('TRACK_EVENT', { data: { type: 'click_download', gameName: 'A', keywords: 'RPG' } }).ok, false);
check('data 缺失拒绝', validateMessage('TRACK_EVENT', {}).ok, false);
check('data 为数组拒绝', validateMessage('TRACK_EVENT', { data: [1, 2] }).ok, false);

console.log('2. 名称类（SEARCH_STEAM / REFRESH_STEAM_CACHE）');
check('SEARCH_STEAM 合法', validateMessage('SEARCH_STEAM', { gameName: '艾尔登法环' }).ok, true);
check('SEARCH_STEAM 空名拒绝', validateMessage('SEARCH_STEAM', { gameName: '  ' }).ok, false);
check('SEARCH_STEAM 缺名拒绝', validateMessage('SEARCH_STEAM', {}).ok, false);
check('REFRESH_STEAM_CACHE 合法', validateMessage('REFRESH_STEAM_CACHE', { gameName: '游戏' }).ok, true);
check('REFRESH_STEAM_CACHE 缺名拒绝', validateMessage('REFRESH_STEAM_CACHE', {}).ok, false);

console.log('3. appId 类（GET_STEAM_BY_APPID / SAVE_MANUAL_MAPPING）');
check('GET_STEAM_BY_APPID 合法', validateMessage('GET_STEAM_BY_APPID', { appId: '275850' }).ok, true);
check('GET_STEAM_BY_APPID 非数字拒绝', validateMessage('GET_STEAM_BY_APPID', { appId: 'abc' }).ok, false);
check('GET_STEAM_BY_APPID 缺 appId 拒绝', validateMessage('GET_STEAM_BY_APPID', {}).ok, false);
check('GET_STEAM_BY_APPID 超长拒绝', validateMessage('GET_STEAM_BY_APPID', { appId: '12345678901' }).ok, false);
check('SAVE_MANUAL_MAPPING 合法', validateMessage('SAVE_MANUAL_MAPPING', { gameName: '游戏', appId: '123' }).ok, true);
check('SAVE_MANUAL_MAPPING 缺 gameName 拒绝', validateMessage('SAVE_MANUAL_MAPPING', { appId: '123' }).ok, false);
check('SAVE_MANUAL_MAPPING 非数字 appId 拒绝', validateMessage('SAVE_MANUAL_MAPPING', { gameName: '游戏', appId: '12x' }).ok, false);

console.log('4. 破坏性操作（RESTORE/DELETE_BACKUP）与限免（CLAIM_FREE_GAME）');
check('RESTORE_BACKUP 合法', validateMessage('RESTORE_BACKUP', { backupId: 'uuid-123' }).ok, true);
check('RESTORE_BACKUP 缺 backupId 拒绝', validateMessage('RESTORE_BACKUP', {}).ok, false);
check('DELETE_BACKUP 缺 backupId 拒绝', validateMessage('DELETE_BACKUP', {}).ok, false);
check('CLAIM_FREE_GAME 合法', validateMessage('CLAIM_FREE_GAME', { gameId: 'epic-999' }).ok, true);
check('CLAIM_FREE_GAME 缺 gameId 拒绝', validateMessage('CLAIM_FREE_GAME', {}).ok, false);

console.log('5. SAVE_SETTINGS 与未契约化放行');
check('SAVE_SETTINGS 合法', validateMessage('SAVE_SETTINGS', { settings: { enabled: true } }).ok, true);
check('SAVE_SETTINGS 数组拒绝', validateMessage('SAVE_SETTINGS', { settings: [1] }).ok, false);
check('SAVE_SETTINGS 缺 settings 拒绝', validateMessage('SAVE_SETTINGS', {}).ok, false);
check('未契约化 action 放行', validateMessage('GET_STATS', {}).ok, true);
check('未知 action 放行（由分发层拒绝）', validateMessage('NO_SUCH_ACTION', {}).ok, true);
check('null 消息放行到分发层（missing action）', validateMessage('GET_STATS', null).ok, true);

export const testResult = { pass, fail, ok: fail === 0 };
