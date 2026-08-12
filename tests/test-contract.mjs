/**
 * Game Recommender - 测试：消息契约校验 / Message Contract Tests
 *
 * v4.0.0：验证 validateMessage 对 9 个高风险 action 的入参校验
 * （白名单 type、必填字段、数字 appId、类型约束），未契约化 action 放行。
 * Verifies validateMessage for the 9 high-risk actions (type whitelist,
 * required fields, numeric appId, type constraints); uncovered actions pass.
 */
'use strict';

import { createReporter } from './helpers/assert.mjs';
const reporter = createReporter();
const { check } = reporter;

const mod = await import(new URL('../background/core/message-contract.js', import.meta.url).href + '?t=' + Date.now());
const { validateMessage } = mod;


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

console.log('6. 第二批契约（v4.1.0：批量/列表/日志/备份类）');
check('GET_RECOMMENDATIONS 合法', validateMessage('GET_RECOMMENDATIONS', { games: [{ name: '游戏A', url: 'x', appId: 1 }] }).ok, true);
check('GET_RECOMMENDATIONS 空数组合法', validateMessage('GET_RECOMMENDATIONS', { games: [] }).ok, true);
check('GET_RECOMMENDATIONS 非数组拒绝', validateMessage('GET_RECOMMENDATIONS', {}).ok, false);
check('GET_RECOMMENDATIONS 缺 name 拒绝', validateMessage('GET_RECOMMENDATIONS', { games: [{ appId: 1 }] }).ok, false);
check('GET_STEAM_RATINGS 合法', validateMessage('GET_STEAM_RATINGS', { names: ['游戏A'], imageData: {} }).ok, true);
check('GET_STEAM_RATINGS 空数组合法', validateMessage('GET_STEAM_RATINGS', { names: [] }).ok, true);
check('GET_STEAM_RATINGS 非数组拒绝', validateMessage('GET_STEAM_RATINGS', {}).ok, false);
check('PREFETCH_STEAM_RATINGS 合法', validateMessage('PREFETCH_STEAM_RATINGS', { names: ['A'], appIds: {} }).ok, true);
check('CLEAR_CACHE_FOR_PAGE 合法', validateMessage('CLEAR_CACHE_FOR_PAGE', { names: ['A'], appIds: ['123'] }).ok, true);
check('CLEAR_CACHE_FOR_PAGE 缺 appIds 拒绝', validateMessage('CLEAR_CACHE_FOR_PAGE', { names: [] }).ok, false);
check('GET_GAME_CACHE_LIST 合法', validateMessage('GET_GAME_CACHE_LIST', { keyword: 'RPG', minRating: 70, page: 1 }).ok, true);
check('GET_GAME_CACHE_LIST 空参合法', validateMessage('GET_GAME_CACHE_LIST', {}).ok, true);
check('GET_GAME_CACHE_LIST 非法 minRating 拒绝', validateMessage('GET_GAME_CACHE_LIST', { minRating: 'x' }).ok, false);
check('SEARCH_STEAM_CANDIDATES 合法', validateMessage('SEARCH_STEAM_CANDIDATES', { gameName: '游戏' }).ok, true);
check('SEARCH_STEAM_CANDIDATES 缺名拒绝', validateMessage('SEARCH_STEAM_CANDIDATES', {}).ok, false);
check('SEARCH_DOWNLOAD_SITES 合法', validateMessage('SEARCH_DOWNLOAD_SITES', { gameName: '游戏', appId: 123 }).ok, true);
check('SEARCH_DOWNLOAD_SITES 缺名拒绝', validateMessage('SEARCH_DOWNLOAD_SITES', {}).ok, false);
check('RECORD_DOWNLOAD_URLS_BATCH 合法', validateMessage('RECORD_DOWNLOAD_URLS_BATCH', { data: { domain: 'x', entries: [{ appId: 123, url: 'https://x' }] } }).ok, true);
check('RECORD_DOWNLOAD_URLS_BATCH 空 entries 合法', validateMessage('RECORD_DOWNLOAD_URLS_BATCH', { data: { entries: [] } }).ok, true);
check('RECORD_DOWNLOAD_URLS_BATCH 缺 data 拒绝', validateMessage('RECORD_DOWNLOAD_URLS_BATCH', {}).ok, false);
check('GET_DOWNLOAD_HISTORY 空参合法', validateMessage('GET_DOWNLOAD_HISTORY', {}).ok, true);
check('GET_DOWNLOAD_HISTORY 带名合法', validateMessage('GET_DOWNLOAD_HISTORY', { gameName: '游戏' }).ok, true);
check('GET_RUNTIME_LOGS limit 合法', validateMessage('GET_RUNTIME_LOGS', { limit: 200 }).ok, true);
check('GET_RUNTIME_LOGS limit 超界拒绝', validateMessage('GET_RUNTIME_LOGS', { limit: 99999 }).ok, false);
check('GET_OUTBOUND_AUDIT 空参合法', validateMessage('GET_OUTBOUND_AUDIT', {}).ok, true);
check('HEAL_REGISTRY_NAMES 空参合法（调用方不发 msg）', validateMessage('HEAL_REGISTRY_NAMES', {}).ok, true);
check('GET_FREE_GAMES force 合法', validateMessage('GET_FREE_GAMES', { force: true }).ok, true);
check('GET_FREE_GAMES force 非布尔拒绝', validateMessage('GET_FREE_GAMES', { force: 'yes' }).ok, false);
check('EXPORT_DATA moduleKeys 合法', validateMessage('EXPORT_DATA', { moduleKeys: ['behaviorLog'] }).ok, true);
check('EXPORT_DATA 无 moduleKeys 合法', validateMessage('EXPORT_DATA', {}).ok, true);
check('EXPORT_DATA moduleKeys 非数组拒绝', validateMessage('EXPORT_DATA', { moduleKeys: 'behaviorLog' }).ok, false);
check('RESTORE_BACKUP 带 moduleKeys 合法', validateMessage('RESTORE_BACKUP', { backupId: 'b-1', moduleKeys: ['settings'] }).ok, true);
check('RESTORE_BACKUP 缺 backupId 仍拒绝', validateMessage('RESTORE_BACKUP', { moduleKeys: ['settings'] }).ok, false);

export const testResult = reporter.getResult();
