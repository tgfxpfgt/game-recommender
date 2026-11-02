/**
 * 游戏雷达 Game Radar - 设置密钥净化（v14.11 B3，报告 B/C P1-03）
 *
 * 导出/备份剔除 API 密钥的**单源**——此前 data-modules.js 与 backups.js 各写
 * 一份只剔 llmConfig.apiKey/steamApiKey 的副本，ITAD 密钥字段
 * （itadApiKey/itadProfiles[].key）从未被剔除，而设置页 UI 明文承诺
 * 「导出/备份/导入均会自动剔除」——虚假安全声明（v3.4.0 承诺对新字段失约）。
 * Strip secrets single source: both export and backup paths previously kept
 * ITAD credentials while the settings UI promised they were stripped.
 */

/**
 * 返回剔除密钥后的设置副本（不修改原对象）。保留 itadProfiles 的 name/id
 * 等非敏感字段，仅置空 key——用户导入后提示重输（与 llmConfig 同语义）。
 * @param {Object} settings - 原设置对象（原样返回当为空）
 * @returns {Object} 剔除密钥后的副本
 */
export function stripSecrets(settings) {
  const s = { ...(settings || {}) };
  if (s.llmConfig) s.llmConfig = { ...s.llmConfig, apiKey: '' };
  if (s.steamApiKey !== undefined) s.steamApiKey = '';
  // v14.11 B3：ITAD 密钥补剔（旧单键 + 多配置 profile 的 key；name/id 保留）
  if (s.itadApiKey !== undefined) s.itadApiKey = '';
  if (Array.isArray(s.itadProfiles)) {
    s.itadProfiles = s.itadProfiles.map((/** @type {Record<string, any>} */ p) =>
      p && typeof p === 'object' ? { ...p, key: '' } : p
    );
  }
  return s;
}
