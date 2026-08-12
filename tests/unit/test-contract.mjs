import { test, expect } from 'vitest';
/**
 * Game Recommender - 测试：消息契约校验 / Message Contract Tests
 *
 * v4.0.0：验证 validateMessage 对 9 个高风险 action 的入参校验
 * （白名单 type、必填字段、数字 appId、类型约束），未契约化 action 放行。
 * Verifies validateMessage for the 9 high-risk actions (type whitelist,
 * required fields, numeric appId, type constraints); uncovered actions pass.
 */
'use strict';


const mod = await import(
  new URL('../../background/core/message-contract.js', import.meta.url).href + '?t=' + Date.now()
);
const { validateMessage } = mod;

console.log('1. TRACK_EVENT（type 白名单 + gameName 必填）');
test('合法 view_detail', () => { expect(validateMessage('TRACK_EVENT', { data: { type: 'view_detail', gameName: '游戏A' } }).ok).toEqual(true); });
test('合法 view_list（无 gameName）', () => { expect(validateMessage('TRACK_EVENT', { data: { type: 'view_list', itemCount: 5 } }).ok).toEqual(true); });
test('合法 steam_tags_update（keywords 数组）', () => { expect(validateMessage('TRACK_EVENT', { data: { type: 'steam_tags_update', gameName: '游戏B', keywords: ['RPG'] } }).ok).toEqual(true); });
test('未知 type 拒绝', () => { expect(validateMessage('TRACK_EVENT', { data: { type: 'hack' } }).ok).toEqual(false); });
test('view_detail 缺 gameName 拒绝', () => { expect(validateMessage('TRACK_EVENT', { data: { type: 'view_detail' } }).ok).toEqual(false); });
test('gameName 超 200 拒绝', () => { expect(validateMessage('TRACK_EVENT', { data: { type: 'click_detail', gameName: 'x'.repeat(201) } }).ok).toEqual(false); });
test('keywords 非数组拒绝', () => { expect(validateMessage('TRACK_EVENT', { data: { type: 'click_download', gameName: 'A', keywords: 'RPG' } }).ok).toEqual(false); });
test('data 缺失拒绝', () => { expect(validateMessage('TRACK_EVENT', {}).ok).toEqual(false); });
test('data 为数组拒绝', () => { expect(validateMessage('TRACK_EVENT', { data: [1, 2] }).ok).toEqual(false); });

console.log('2. 名称类（SEARCH_STEAM / REFRESH_STEAM_CACHE）');
test('SEARCH_STEAM 合法', () => { expect(validateMessage('SEARCH_STEAM', { gameName: '艾尔登法环' }).ok).toEqual(true); });
test('SEARCH_STEAM 空名拒绝', () => { expect(validateMessage('SEARCH_STEAM', { gameName: '  ' }).ok).toEqual(false); });
test('SEARCH_STEAM 缺名拒绝', () => { expect(validateMessage('SEARCH_STEAM', {}).ok).toEqual(false); });
test('REFRESH_STEAM_CACHE 合法', () => { expect(validateMessage('REFRESH_STEAM_CACHE', { gameName: '游戏' }).ok).toEqual(true); });
test('REFRESH_STEAM_CACHE 缺名拒绝', () => { expect(validateMessage('REFRESH_STEAM_CACHE', {}).ok).toEqual(false); });

console.log('3. appId 类（GET_STEAM_BY_APPID / SAVE_MANUAL_MAPPING）');
test('GET_STEAM_BY_APPID 合法', () => { expect(validateMessage('GET_STEAM_BY_APPID', { appId: '275850' }).ok).toEqual(true); });
test('GET_STEAM_BY_APPID 非数字拒绝', () => { expect(validateMessage('GET_STEAM_BY_APPID', { appId: 'abc' }).ok).toEqual(false); });
test('GET_STEAM_BY_APPID 缺 appId 拒绝', () => { expect(validateMessage('GET_STEAM_BY_APPID', {}).ok).toEqual(false); });
test('GET_STEAM_BY_APPID 超长拒绝', () => { expect(validateMessage('GET_STEAM_BY_APPID', { appId: '12345678901' }).ok).toEqual(false); });
test('SAVE_MANUAL_MAPPING 合法', () => { expect(validateMessage('SAVE_MANUAL_MAPPING', { gameName: '游戏', appId: '123' }).ok).toEqual(true); });
test('SAVE_MANUAL_MAPPING 缺 gameName 拒绝', () => { expect(validateMessage('SAVE_MANUAL_MAPPING', { appId: '123' }).ok).toEqual(false); });
test('SAVE_MANUAL_MAPPING 非数字 appId 拒绝', () => { expect(validateMessage('SAVE_MANUAL_MAPPING', { gameName: '游戏', appId: '12x' }).ok).toEqual(false); });

console.log('4. 破坏性操作（RESTORE/DELETE_BACKUP）与限免（CLAIM_FREE_GAME）');
test('RESTORE_BACKUP 合法', () => { expect(validateMessage('RESTORE_BACKUP', { backupId: 'uuid-123' }).ok).toEqual(true); });
test('RESTORE_BACKUP 缺 backupId 拒绝', () => { expect(validateMessage('RESTORE_BACKUP', {}).ok).toEqual(false); });
test('DELETE_BACKUP 缺 backupId 拒绝', () => { expect(validateMessage('DELETE_BACKUP', {}).ok).toEqual(false); });
test('CLAIM_FREE_GAME 合法', () => { expect(validateMessage('CLAIM_FREE_GAME', { gameId: 'epic-999' }).ok).toEqual(true); });
test('CLAIM_FREE_GAME 缺 gameId 拒绝', () => { expect(validateMessage('CLAIM_FREE_GAME', {}).ok).toEqual(false); });

console.log('5. SAVE_SETTINGS 与未契约化放行');
test('SAVE_SETTINGS 合法', () => { expect(validateMessage('SAVE_SETTINGS', { settings: { enabled: true } }).ok).toEqual(true); });
test('SAVE_SETTINGS 数组拒绝', () => { expect(validateMessage('SAVE_SETTINGS', { settings: [1] }).ok).toEqual(false); });
test('SAVE_SETTINGS 缺 settings 拒绝', () => { expect(validateMessage('SAVE_SETTINGS', {}).ok).toEqual(false); });
test('未契约化 action 放行', () => { expect(validateMessage('GET_STATS', {}).ok).toEqual(true); });
test('未知 action 放行（由分发层拒绝）', () => { expect(validateMessage('NO_SUCH_ACTION', {}).ok).toEqual(true); });
test('null 消息放行到分发层（missing action）', () => { expect(validateMessage('GET_STATS', null).ok).toEqual(true); });

console.log('6. 第二批契约（v4.1.0：批量/列表/日志/备份类）');
console.log('6a. 批量与推荐类（GET_RECOMMENDATIONS/GET_STEAM_RATINGS/PREFETCH）');
test('GET_RECOMMENDATIONS 合法', () => { expect(validateMessage('GET_RECOMMENDATIONS', { games: [{ name: '游戏A', url: 'x', appId: 1 }] }).ok).toEqual(true); });
test('GET_RECOMMENDATIONS 空数组合法', () => { expect(validateMessage('GET_RECOMMENDATIONS', { games: [] }).ok).toEqual(true); });
test('GET_RECOMMENDATIONS 非数组拒绝', () => { expect(validateMessage('GET_RECOMMENDATIONS', {}).ok).toEqual(false); });
test('GET_RECOMMENDATIONS 缺 name 拒绝', () => { expect(validateMessage('GET_RECOMMENDATIONS', { games: [{ appId: 1 }] }).ok).toEqual(false); });
test('GET_STEAM_RATINGS 合法', () => { expect(validateMessage('GET_STEAM_RATINGS', { names: ['游戏A'], imageData: {} }).ok).toEqual(true); });
test('GET_STEAM_RATINGS 空数组合法', () => { expect(validateMessage('GET_STEAM_RATINGS', { names: [] }).ok).toEqual(true); });
test('GET_STEAM_RATINGS 非数组拒绝', () => { expect(validateMessage('GET_STEAM_RATINGS', {}).ok).toEqual(false); });
test('PREFETCH_STEAM_RATINGS 合法', () => { expect(validateMessage('PREFETCH_STEAM_RATINGS', { names: ['A'], appIds: {} }).ok).toEqual(true); });
test('CLEAR_CACHE_FOR_PAGE 合法', () => { expect(validateMessage('CLEAR_CACHE_FOR_PAGE', { names: ['A'], appIds: ['123'] }).ok).toEqual(true); });
test('CLEAR_CACHE_FOR_PAGE 缺 appIds 拒绝', () => { expect(validateMessage('CLEAR_CACHE_FOR_PAGE', { names: [] }).ok).toEqual(false); });
console.log('6b. 列表与搜索类（CLEAR_CACHE_FOR_PAGE/GET_GAME_CACHE_LIST/SEARCH_*）');
test('GET_GAME_CACHE_LIST 合法', () => { expect(validateMessage('GET_GAME_CACHE_LIST', { keyword: 'RPG', minRating: 70, page: 1 }).ok).toEqual(true); });
test('GET_GAME_CACHE_LIST 空参合法', () => { expect(validateMessage('GET_GAME_CACHE_LIST', {}).ok).toEqual(true); });
test('GET_GAME_CACHE_LIST 非法 minRating 拒绝', () => { expect(validateMessage('GET_GAME_CACHE_LIST', { minRating: 'x' }).ok).toEqual(false); });
test('SEARCH_STEAM_CANDIDATES 合法', () => { expect(validateMessage('SEARCH_STEAM_CANDIDATES', { gameName: '游戏' }).ok).toEqual(true); });
test('SEARCH_STEAM_CANDIDATES 缺名拒绝', () => { expect(validateMessage('SEARCH_STEAM_CANDIDATES', {}).ok).toEqual(false); });
test('SEARCH_DOWNLOAD_SITES 合法', () => { expect(validateMessage('SEARCH_DOWNLOAD_SITES', { gameName: '游戏', appId: 123 }).ok).toEqual(true); });
test('SEARCH_DOWNLOAD_SITES 缺名拒绝', () => { expect(validateMessage('SEARCH_DOWNLOAD_SITES', {}).ok).toEqual(false); });
test('RECORD_DOWNLOAD_URLS_BATCH 合法', () => { expect(validateMessage('RECORD_DOWNLOAD_URLS_BATCH', { data: { domain: 'x', entries: [{ appId: 123, url: 'https://x' }] } })
    .ok).toEqual(true); });
test('RECORD_DOWNLOAD_URLS_BATCH 空 entries 合法', () => { expect(validateMessage('RECORD_DOWNLOAD_URLS_BATCH', { data: { entries: [] } }).ok).toEqual(true); });
test('RECORD_DOWNLOAD_URLS_BATCH 缺 data 拒绝', () => { expect(validateMessage('RECORD_DOWNLOAD_URLS_BATCH', {}).ok).toEqual(false); });
test('GET_DOWNLOAD_HISTORY 空参合法', () => { expect(validateMessage('GET_DOWNLOAD_HISTORY', {}).ok).toEqual(true); });
test('GET_DOWNLOAD_HISTORY 带名合法', () => { expect(validateMessage('GET_DOWNLOAD_HISTORY', { gameName: '游戏' }).ok).toEqual(true); });
console.log('6c. 日志/限免/备份类（limit/moduleKeys/force）');
test('GET_RUNTIME_LOGS limit 合法', () => { expect(validateMessage('GET_RUNTIME_LOGS', { limit: 200 }).ok).toEqual(true); });
test('GET_RUNTIME_LOGS limit 超界拒绝', () => { expect(validateMessage('GET_RUNTIME_LOGS', { limit: 99999 }).ok).toEqual(false); });
test('GET_OUTBOUND_AUDIT 空参合法', () => { expect(validateMessage('GET_OUTBOUND_AUDIT', {}).ok).toEqual(true); });
test('HEAL_REGISTRY_NAMES 空参合法（调用方不发 msg）', () => { expect(validateMessage('HEAL_REGISTRY_NAMES', {}).ok).toEqual(true); });
test('GET_FREE_GAMES force 合法', () => { expect(validateMessage('GET_FREE_GAMES', { force: true }).ok).toEqual(true); });
test('GET_FREE_GAMES force 非布尔拒绝', () => { expect(validateMessage('GET_FREE_GAMES', { force: 'yes' }).ok).toEqual(false); });
test('EXPORT_DATA moduleKeys 合法', () => { expect(validateMessage('EXPORT_DATA', { moduleKeys: ['behaviorLog'] }).ok).toEqual(true); });
test('EXPORT_DATA 无 moduleKeys 合法', () => { expect(validateMessage('EXPORT_DATA', {}).ok).toEqual(true); });
test('EXPORT_DATA moduleKeys 非数组拒绝', () => { expect(validateMessage('EXPORT_DATA', { moduleKeys: 'behaviorLog' }).ok).toEqual(false); });
test('RESTORE_BACKUP 带 moduleKeys 合法', () => { expect(validateMessage('RESTORE_BACKUP', { backupId: 'b-1', moduleKeys: ['settings'] }).ok).toEqual(true); });
test('RESTORE_BACKUP 缺 backupId 仍拒绝', () => { expect(validateMessage('RESTORE_BACKUP', { moduleKeys: ['settings'] }).ok).toEqual(false); });

console.log('7. 第三批契约（v6.2.0：写/破坏性 action 全量）');
console.log('7a. 无参清理类（恒通过，防误判为未覆盖）');
test('RESET_SETTINGS 合法', () => { expect(validateMessage('RESET_SETTINGS', {}).ok).toEqual(true); });
test('CLEAR_DATA 合法', () => { expect(validateMessage('CLEAR_DATA', {}).ok).toEqual(true); });
test('CLEAR_RUNTIME_LOGS 合法', () => { expect(validateMessage('CLEAR_RUNTIME_LOGS', {}).ok).toEqual(true); });
test('CLEAR_OUTBOUND_AUDIT 合法', () => { expect(validateMessage('CLEAR_OUTBOUND_AUDIT', {}).ok).toEqual(true); });
test('CLEAR_GAME_CACHE 合法', () => { expect(validateMessage('CLEAR_GAME_CACHE', {}).ok).toEqual(true); });
test('DELETE_ADAPTER_RULES 合法', () => { expect(validateMessage('DELETE_ADAPTER_RULES', {}).ok).toEqual(true); });
test('CLEAN_EXPIRED_CACHE 合法', () => { expect(validateMessage('CLEAN_EXPIRED_CACHE', {}).ok).toEqual(true); });
console.log('7b. 缓存条目级操作（appId 必填）');
test('DELETE_GAME_CACHE_ENTRY 合法', () => { expect(validateMessage('DELETE_GAME_CACHE_ENTRY', { appId: '275850' }).ok).toEqual(true); });
test('DELETE_GAME_CACHE_ENTRY 非数字拒绝', () => { expect(validateMessage('DELETE_GAME_CACHE_ENTRY', { appId: 'x' }).ok).toEqual(false); });
test('DELETE_GAME_CACHE_ENTRY 缺 appId 拒绝', () => { expect(validateMessage('DELETE_GAME_CACHE_ENTRY', {}).ok).toEqual(false); });
test('REFRESH_GAME_CACHE_ENTRY 合法', () => { expect(validateMessage('REFRESH_GAME_CACHE_ENTRY', { appId: '123' }).ok).toEqual(true); });
test('REFRESH_GAME_CACHE_ENTRY 非数字拒绝', () => { expect(validateMessage('REFRESH_GAME_CACHE_ENTRY', { appId: 'abc' }).ok).toEqual(false); });
test('CACHE_STEAM_PAGE 合法（带可选 gameName）', () => { expect(validateMessage('CACHE_STEAM_PAGE', { appId: '1', gameName: '游戏' }).ok).toEqual(true); });
test('CACHE_STEAM_PAGE 缺 appId 拒绝', () => { expect(validateMessage('CACHE_STEAM_PAGE', { gameName: '游戏' }).ok).toEqual(false); });
console.log('7c. 站点访问/规则/报错类');
test('TRACK_DOWNLOAD_SITE_VISIT 合法', () => { expect(validateMessage('TRACK_DOWNLOAD_SITE_VISIT', { data: { appId: 123, url: 'https://xdgame.com/1.html', domain: 'xdgame.com' } }).ok).toEqual(true); });
test('TRACK_DOWNLOAD_SITE_VISIT 缺 url 拒绝', () => { expect(validateMessage('TRACK_DOWNLOAD_SITE_VISIT', { data: { appId: 123 } }).ok).toEqual(false); });
test('TRACK_DOWNLOAD_SITE_VISIT 缺 data 拒绝', () => { expect(validateMessage('TRACK_DOWNLOAD_SITE_VISIT', {}).ok).toEqual(false); });
test('SAVE_ADAPTER_RULES 合法', () => { expect(validateMessage('SAVE_ADAPTER_RULES', { rules: { version: 1, sites: [] } }).ok).toEqual(true); });
test('SAVE_ADAPTER_RULES 非对象拒绝', () => { expect(validateMessage('SAVE_ADAPTER_RULES', { rules: 'x' }).ok).toEqual(false); });
test('REPORT_WRONG_APPID 合法（appId + gameName）', () => { expect(validateMessage('REPORT_WRONG_APPID', { appId: '730', gameName: '游戏' }).ok).toEqual(true); });
test('REPORT_WRONG_APPID 仅 gameName 合法', () => { expect(validateMessage('REPORT_WRONG_APPID', { gameName: '游戏' }).ok).toEqual(true); });
test('REPORT_WRONG_APPID 全空拒绝', () => { expect(validateMessage('REPORT_WRONG_APPID', {}).ok).toEqual(false); });
test('REPORT_WRONG_APPID 非数字 appId 拒绝', () => { expect(validateMessage('REPORT_WRONG_APPID', { appId: 'x', gameName: '游戏' }).ok).toEqual(false); });

